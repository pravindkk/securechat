/**
 * Member Service
 *
 * Handles group member management operations including add, remove,
 * promote, demote, and leave room functionality.
 */

import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../middleware/errorHandler.js';
import { cacheService } from './cacheService.js';

type TransactionClient = Prisma.TransactionClient;

// Constants for group management
const MAX_GROUP_MEMBERS = 30;

export class MemberService {
  /**
   * Add a member to a group (admin only)
   */
  async addMember(
    roomId: string,
    requesterId: string,
    newMemberId: string,
    encryptedRoomKey: string,
    historicalKeys?: { version: number; encryptedKey: string }[]
  ) {
    // Verify requester is admin (outside transaction for early fail)
    await this.requireAdmin(roomId, requesterId);

    // Verify the new user exists (outside transaction for early fail)
    const newUser = await prisma.user.findUnique({
      where: { id: newMemberId },
      select: { id: true, name: true, email: true, photoUrl: true, state: true, publicKey: true },
    });

    if (!newUser) {
      throw new NotFoundError('User not found');
    }

    // Use a transaction to ensure atomicity of all database operations
    await prisma.$transaction(async (tx: TransactionClient) => {
      // Check room exists and is a group
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: {
          members: true,
          keyHistory: {
            include: { memberKeys: true },
          },
        },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      if (room.isPrivate) {
        throw new BadRequestError('Cannot add members to private chats');
      }

      if (room.members.length >= room.maxMembers) {
        throw new BadRequestError(`Group cannot exceed ${room.maxMembers} members`);
      }

      // Check if user is already a member
      const existingMember = room.members.find((m) => m.userId === newMemberId);
      if (existingMember) {
        throw new ConflictError('User is already a member of this group');
      }

      // Add the new member
      await tx.roomMember.create({
        data: {
          roomId,
          userId: newMemberId,
          role: 'member',
          encryptedRoomKey,
          keyVersion: room.roomKeyVersion,
          addedBy: requesterId,
        },
      });

      // Store historical keys for the new member (for full history access)
      if (historicalKeys && historicalKeys.length > 0) {
        for (const histKey of historicalKeys) {
          const keyHistory = room.keyHistory.find((kh) => kh.version === histKey.version);
          if (keyHistory) {
            await tx.roomMemberKeyHistory.create({
              data: {
                roomKeyHistoryId: keyHistory.id,
                userId: newMemberId,
                encryptedRoomKey: histKey.encryptedKey,
              },
            });
          }
        }
      }

      // Create user chat entry
      await tx.userChat.create({
        data: {
          userId: newMemberId,
          roomId,
          otherUserId: null,
        },
      });
    });

    // Invalidate caches for the room and affected users
    await Promise.all([
      cacheService.invalidateRoomCache(roomId),
      cacheService.invalidateUserChats(newMemberId),
    ]);

    return {
      member: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        photoUrl: newUser.photoUrl,
        state: newUser.state,
        role: 'member',
        publicKey: newUser.publicKey,
      },
    };
  }

  /**
   * Remove a member from a group (admin only)
   */
  async removeMember(roomId: string, requesterId: string, targetMemberId: string) {
    // Verify requester is admin
    await this.requireAdmin(roomId, requesterId);

    // Cannot remove yourself - use leaveRoom instead
    if (requesterId === targetMemberId) {
      throw new BadRequestError('Use leave endpoint to leave the group');
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { members: true },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    if (room.isPrivate) {
      throw new BadRequestError('Cannot remove members from private chats');
    }

    // Check target is a member
    const targetMember = room.members.find((m) => m.userId === targetMemberId);
    if (!targetMember) {
      throw new NotFoundError('User is not a member of this group');
    }

    // Check if removing the last admin
    if (targetMember.role === 'admin') {
      const adminCount = room.members.filter((m) => m.role === 'admin').length;
      if (adminCount === 1) {
        throw new BadRequestError('Cannot remove the last admin. Promote another member first.');
      }
    }

    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      // Step 1: Remove the member FIRST (before archiving)
      await tx.roomMember.delete({
        where: { roomId_userId: { roomId, userId: targetMemberId } },
      });

      // Step 2: Remove user chat entry
      await tx.userChat.deleteMany({
        where: { roomId, userId: targetMemberId },
      });

      // Step 2.5: Clean up any historical key entries for removed member
      await tx.roomMemberKeyHistory.deleteMany({
        where: {
          roomKeyHistory: { roomId },
          userId: targetMemberId,
        },
      });

      // Step 3: Archive current room key (now without the removed member)
      // Get remaining members after removal
      const remainingMembers = await tx.roomMember.findMany({
        where: { roomId },
      });

      // Check if this version already exists in history
      const existingHistory = await tx.roomKeyHistory.findUnique({
        where: { roomId_version: { roomId, version: room.roomKeyVersion } },
      });

      if (!existingHistory) {
        // Create key history entry
        const keyHistory = await tx.roomKeyHistory.create({
          data: {
            roomId,
            version: room.roomKeyVersion,
          },
        });

        // Store each REMAINING member's encrypted key in history (not the removed member)
        for (const member of remainingMembers) {
          await tx.roomMemberKeyHistory.create({
            data: {
              roomKeyHistoryId: keyHistory.id,
              userId: member.userId,
              encryptedRoomKey: member.encryptedRoomKey,
            },
          });
        }
      }

      // Step 4: Increment room key version (rotation will be done client-side)
      const updatedRoom = await tx.room.update({
        where: { id: roomId },
        data: { roomKeyVersion: { increment: 1 } },
      });

      return { newKeyVersion: updatedRoom.roomKeyVersion };
    });

    // Invalidate caches for the room and removed user
    await Promise.all([
      cacheService.invalidateRoomCache(roomId),
      cacheService.invalidateUserChats(targetMemberId),
    ]);

    return result;
  }

  /**
   * Member leaves group voluntarily
   */
  async leaveRoom(roomId: string, userId: string) {
    // Use a transaction to ensure atomicity - all reads and writes in same transaction
    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { members: true },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      if (room.isPrivate) {
        throw new BadRequestError('Cannot leave private chats');
      }

      // Check user is a member
      const member = room.members.find((m) => m.userId === userId);
      if (!member) {
        throw new NotFoundError('Not a member of this group');
      }

      // If user is admin, ensure at least one admin remains
      if (member.role === 'admin') {
        const otherAdmins = room.members.filter((m) => m.role === 'admin' && m.userId !== userId);
        if (otherAdmins.length === 0) {
          // Try to promote another member (by join date, earliest first)
          const otherMember = room.members
            .filter((m) => m.userId !== userId)
            .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
          if (otherMember) {
            await tx.roomMember.update({
              where: { id: otherMember.id },
              data: { role: 'admin' },
            });
          }
        }
      }

      // Remove the member FIRST (before archiving)
      await tx.roomMember.delete({
        where: { roomId_userId: { roomId, userId } },
      });

      // Remove user chat entry
      await tx.userChat.deleteMany({
        where: { roomId, userId },
      });

      // Check if room is now empty
      const remainingMemberCount = await tx.roomMember.count({ where: { roomId } });
      if (remainingMemberCount === 0) {
        // Delete the room
        await tx.room.delete({ where: { id: roomId } });
        return { roomDeleted: true, newKeyVersion: null };
      }

      // Archive current room key (after member removal)
      const remainingMembers = await tx.roomMember.findMany({
        where: { roomId },
      });

      // Check if this version already exists in history
      const existingHistory = await tx.roomKeyHistory.findUnique({
        where: { roomId_version: { roomId, version: room.roomKeyVersion } },
      });

      if (!existingHistory) {
        // Create key history entry
        const keyHistory = await tx.roomKeyHistory.create({
          data: {
            roomId,
            version: room.roomKeyVersion,
          },
        });

        // Store each REMAINING member's encrypted key in history
        for (const remainingMember of remainingMembers) {
          await tx.roomMemberKeyHistory.create({
            data: {
              roomKeyHistoryId: keyHistory.id,
              userId: remainingMember.userId,
              encryptedRoomKey: remainingMember.encryptedRoomKey,
            },
          });
        }
      }

      // Increment room key version
      const updatedRoom = await tx.room.update({
        where: { id: roomId },
        data: { roomKeyVersion: { increment: 1 } },
      });

      return { roomDeleted: false, newKeyVersion: updatedRoom.roomKeyVersion };
    });

    // Invalidate caches for the room and leaving user
    await Promise.all([
      cacheService.invalidateRoomCache(roomId),
      cacheService.invalidateUserChats(userId),
    ]);

    return result;
  }

  /**
   * Promote a member to admin
   */
  async promoteMember(roomId: string, requesterId: string, targetMemberId: string) {
    await this.requireAdmin(roomId, requesterId);

    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetMemberId } },
    });

    if (!member) {
      throw new NotFoundError('User is not a member of this group');
    }

    if (member.role === 'admin') {
      throw new BadRequestError('User is already an admin');
    }

    await prisma.roomMember.update({
      where: { id: member.id },
      data: { role: 'admin' },
    });

    return { success: true };
  }

  /**
   * Demote an admin to member
   */
  async demoteMember(roomId: string, requesterId: string, targetMemberId: string) {
    await this.requireAdmin(roomId, requesterId);

    // Cannot demote yourself
    if (requesterId === targetMemberId) {
      throw new BadRequestError('Cannot demote yourself');
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { members: true },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      const targetMember = room.members.find((m) => m.userId === targetMemberId);
      if (!targetMember) {
        throw new NotFoundError('User is not a member of this group');
      }

      if (targetMember.role !== 'admin') {
        throw new BadRequestError('User is not an admin');
      }

      // Ensure at least one admin remains (checked within transaction)
      const adminCount = room.members.filter((m) => m.role === 'admin').length;
      if (adminCount <= 1) {
        throw new BadRequestError('Cannot demote the last admin');
      }

      await tx.roomMember.update({
        where: { id: targetMember.id },
        data: { role: 'member' },
      });
    });

    return { success: true };
  }

  /**
   * Get all room members with their details
   */
  async getRoomMembers(roomId: string) {
    const members = await prisma.roomMember.findMany({
      where: { roomId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoUrl: true,
            state: true,
            publicKey: true,
          },
        },
      },
    });

    return members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      photoUrl: m.user.photoUrl,
      state: m.user.state,
      role: m.role,
      publicKey: m.user.publicKey,
      joinedAt: m.joinedAt.toISOString(),
      addedBy: m.addedBy,
    }));
  }

  /**
   * Check if user is admin of room
   */
  async isAdmin(roomId: string, userId: string): Promise<boolean> {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    return member?.role === 'admin';
  }

  /**
   * Get member's role in room
   */
  async getMemberRole(roomId: string, userId: string): Promise<'admin' | 'member' | null> {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    return member?.role as 'admin' | 'member' | null;
  }

  /**
   * Helper to verify user is admin and throw if not
   */
  private async requireAdmin(roomId: string, userId: string) {
    const isAdmin = await this.isAdmin(roomId, userId);
    if (!isAdmin) {
      throw new ForbiddenError('Admin privileges required');
    }
  }
}

export const memberService = new MemberService();
export default memberService;
