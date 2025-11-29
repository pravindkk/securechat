/**
 * Room Service
 *
 * Core room CRUD operations. For specialized operations, see:
 * - memberService.ts - Member management (add/remove/promote/demote)
 * - keyRotationService.ts - Encryption key management
 * - groupSettingsService.ts - Group settings (name/photo/delete)
 */

import { prisma } from '../config/database.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../middleware/errorHandler.js';
import { rsaEncrypt, generateRoomKey } from '../utils/helpers.js';
import { userService } from './userService.js';
import { cacheService } from './cacheService.js';

// Re-export specialized services for backward compatibility
export { memberService } from './memberService.js';
export { keyRotationService } from './keyRotationService.js';
export { groupSettingsService } from './groupSettingsService.js';

// Constants for group management
const MAX_GROUP_MEMBERS = 30;
const MIN_GROUP_MEMBERS = 2;

export class RoomService {
  /**
   * Create a new room with encrypted room key for each member
   */
  async createRoom(
    creatorId: string,
    memberIds: string[],
    name?: string,
    isPrivate: boolean = true
  ) {
    // Ensure creator is in members list
    const allMemberIds = [...new Set([creatorId, ...memberIds])];

    if (isPrivate && allMemberIds.length !== 2) {
      throw new BadRequestError('Private rooms must have exactly 2 members');
    }

    // For private chats, check if room already exists
    if (isPrivate) {
      const existingRoom = await this.findExistingPrivateRoom(allMemberIds[0], allMemberIds[1]);
      if (existingRoom) {
        return this.getRoomWithMembers(existingRoom.id);
      }
    }

    // Generate room key
    const roomKey = generateRoomKey();

    // Get public keys for all members (outside transaction for early fail)
    const publicKeys = await userService.getMultipleUsersPublicKeys(allMemberIds);

    // Use transaction to ensure atomicity of room creation and user chat entries
    const room = await prisma.$transaction(async (tx) => {
      // Create room with members
      const newRoom = await tx.room.create({
        data: {
          name: isPrivate ? null : name,
          isPrivate,
          createdBy: creatorId,
          members: {
            create: allMemberIds.map((userId) => {
              const publicKey = publicKeys.get(userId);
              if (!publicKey) {
                throw new NotFoundError(`Public key not found for user ${userId}`);
              }
              // Encrypt room key with user's public key
              const encryptedRoomKey = rsaEncrypt(roomKey, publicKey);
              return {
                userId,
                role: userId === creatorId ? 'admin' : 'member',
                encryptedRoomKey,
              };
            }),
          },
        },
        include: {
          members: {
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
          },
        },
      });

      // Create user chat entries within the same transaction
      for (const memberId of allMemberIds) {
        const otherMember = isPrivate
          ? allMemberIds.find((id) => id !== memberId)
          : null;

        await tx.userChat.create({
          data: {
            userId: memberId,
            roomId: newRoom.id,
            otherUserId: otherMember,
          },
        });
      }

      return newRoom;
    });

    return this.formatRoomResponse(room);
  }

  /**
   * Create a new group chat
   */
  async createGroupRoom(
    creatorId: string,
    memberIds: string[],
    name: string
  ) {
    const allMemberIds = [...new Set([creatorId, ...memberIds])];

    if (allMemberIds.length < MIN_GROUP_MEMBERS) {
      throw new BadRequestError(`Group must have at least ${MIN_GROUP_MEMBERS} members`);
    }

    if (allMemberIds.length > MAX_GROUP_MEMBERS) {
      throw new BadRequestError(`Group cannot exceed ${MAX_GROUP_MEMBERS} members`);
    }

    if (!name || name.trim().length === 0) {
      throw new BadRequestError('Group name is required');
    }

    // Generate room key
    const roomKey = generateRoomKey();

    // Get public keys for all members (outside transaction for early fail)
    const publicKeys = await userService.getMultipleUsersPublicKeys(allMemberIds);

    // Use transaction to ensure atomicity of room and UserChat creation
    const room = await prisma.$transaction(async (tx) => {
      // Create room with isPrivate = false for groups
      const newRoom = await tx.room.create({
        data: {
          name: name.trim(),
          isPrivate: false,
          createdBy: creatorId,
          maxMembers: MAX_GROUP_MEMBERS,
          members: {
            create: allMemberIds.map((userId) => {
              const publicKey = publicKeys.get(userId);
              if (!publicKey) {
                throw new NotFoundError(`Public key not found for user ${userId}`);
              }
              const encryptedRoomKey = rsaEncrypt(roomKey, publicKey);
              return {
                userId,
                role: userId === creatorId ? 'admin' : 'member',
                encryptedRoomKey,
                addedBy: userId === creatorId ? null : creatorId,
              };
            }),
          },
        },
        include: {
          members: {
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
          },
        },
      });

      // Create user chat entries for all members within the same transaction
      for (const memberId of allMemberIds) {
        await tx.userChat.create({
          data: {
            userId: memberId,
            roomId: newRoom.id,
            otherUserId: null, // No other user for groups
          },
        });
      }

      return newRoom;
    });

    return this.formatRoomResponse(room);
  }

  /**
   * Get room by ID with all members
   */
  async getRoomWithMembers(roomId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: {
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
        },
      },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    return this.formatRoomResponse(room);
  }

  /**
   * Get all chats for a user
   */
  async getUserChats(userId: string) {
    const userChats = await prisma.userChat.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        room: {
          include: {
            members: {
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
            },
          },
        },
      },
    });

    return userChats.map((chat) => ({
      id: chat.room.id,
      name: chat.room.name,
      isPrivate: chat.room.isPrivate,
      photoUrl: chat.room.photoUrl,
      lastMessagePreview: chat.lastMessagePreview,
      lastMessageAt: chat.lastMessageAt?.toISOString() || null,
      unreadCount: chat.unreadCount,
      otherUser: chat.room.isPrivate
        ? chat.room.members
            .find((m) => m.userId !== userId)
            ?.user || null
        : null,
      members: chat.room.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        photoUrl: m.user.photoUrl,
        state: m.user.state,
        role: m.role,
        publicKey: m.user.publicKey,
        encryptedRoomKey: m.encryptedRoomKey,
        keyVersion: m.keyVersion,
      })),
    }));
  }

  /**
   * Update last message in chat
   */
  async updateLastMessage(roomId: string, preview: string): Promise<void> {
    await prisma.userChat.updateMany({
      where: { roomId },
      data: {
        lastMessagePreview: preview,
        lastMessageAt: new Date(),
      },
    });
  }

  /**
   * Increment unread count for all members except sender
   */
  async incrementUnreadCount(roomId: string, senderId: string): Promise<void> {
    await prisma.userChat.updateMany({
      where: {
        roomId,
        userId: { not: senderId },
      },
      data: {
        unreadCount: { increment: 1 },
      },
    });

    await prisma.roomMember.updateMany({
      where: {
        roomId,
        userId: { not: senderId },
      },
      data: {
        unreadCount: { increment: 1 },
      },
    });
  }

  /**
   * Mark room as read
   */
  async markAsRead(roomId: string, userId: string): Promise<void> {
    await prisma.userChat.updateMany({
      where: { roomId, userId },
      data: { unreadCount: 0 },
    });

    await prisma.roomMember.updateMany({
      where: { roomId, userId },
      data: {
        unreadCount: 0,
        lastReadAt: new Date(),
      },
    });
  }

  /**
   * Check if user is member of room (with caching)
   */
  async isMember(roomId: string, userId: string): Promise<boolean> {
    // Check cache first
    const cached = await cacheService.getRoomMembership(roomId, userId);
    if (cached !== null) {
      return cached;
    }

    // Query database
    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
    });
    const isMember = !!member;

    // Cache the result
    await cacheService.cacheRoomMembership(roomId, userId, isMember);

    return isMember;
  }

  /**
   * Get user's room key
   * @deprecated Use keyRotationService.getUserRoomKey instead
   */
  async getUserRoomKey(roomId: string, userId: string): Promise<string> {
    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
      select: { encryptedRoomKey: true },
    });

    if (!member) {
      throw new ForbiddenError('Not a member of this room');
    }

    return member.encryptedRoomKey;
  }

  // ==========================================
  // BACKWARD COMPATIBILITY METHODS
  // These delegate to specialized services
  // ==========================================

  /**
   * @deprecated Use memberService.addMember instead
   */
  async addMember(
    roomId: string,
    requesterId: string,
    newMemberId: string,
    encryptedRoomKey: string,
    historicalKeys?: { version: number; encryptedKey: string }[]
  ) {
    const { memberService } = await import('./memberService.js');
    return memberService.addMember(roomId, requesterId, newMemberId, encryptedRoomKey, historicalKeys);
  }

  /**
   * @deprecated Use memberService.removeMember instead
   */
  async removeMember(roomId: string, requesterId: string, targetMemberId: string) {
    const { memberService } = await import('./memberService.js');
    return memberService.removeMember(roomId, requesterId, targetMemberId);
  }

  /**
   * @deprecated Use memberService.leaveRoom instead
   */
  async leaveRoom(roomId: string, userId: string) {
    const { memberService } = await import('./memberService.js');
    return memberService.leaveRoom(roomId, userId);
  }

  /**
   * @deprecated Use keyRotationService.rotateRoomKey instead
   */
  async rotateRoomKey(roomId: string, requesterId: string, encryptedKeys: Record<string, string>) {
    const { keyRotationService } = await import('./keyRotationService.js');
    return keyRotationService.rotateRoomKey(roomId, requesterId, encryptedKeys);
  }

  /**
   * @deprecated Use memberService.promoteMember instead
   */
  async promoteMember(roomId: string, requesterId: string, targetMemberId: string) {
    const { memberService } = await import('./memberService.js');
    return memberService.promoteMember(roomId, requesterId, targetMemberId);
  }

  /**
   * @deprecated Use memberService.demoteMember instead
   */
  async demoteMember(roomId: string, requesterId: string, targetMemberId: string) {
    const { memberService } = await import('./memberService.js');
    return memberService.demoteMember(roomId, requesterId, targetMemberId);
  }

  /**
   * @deprecated Use groupSettingsService.updateGroupRoom instead
   */
  async updateGroupRoom(roomId: string, requesterId: string, data: { name?: string; photoUrl?: string | null }) {
    const { groupSettingsService } = await import('./groupSettingsService.js');
    return groupSettingsService.updateGroupRoom(roomId, requesterId, data);
  }

  /**
   * @deprecated Use groupSettingsService.deleteGroupRoom instead
   */
  async deleteGroupRoom(roomId: string, requesterId: string) {
    const { groupSettingsService } = await import('./groupSettingsService.js');
    return groupSettingsService.deleteGroupRoom(roomId, requesterId);
  }

  /**
   * @deprecated Use groupSettingsService.deleteRoom instead
   */
  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const { groupSettingsService } = await import('./groupSettingsService.js');
    return groupSettingsService.deleteRoom(roomId, userId);
  }

  /**
   * @deprecated Use memberService.isAdmin instead
   */
  async isAdmin(roomId: string, userId: string): Promise<boolean> {
    const { memberService } = await import('./memberService.js');
    return memberService.isAdmin(roomId, userId);
  }

  /**
   * @deprecated Use memberService.getMemberRole instead
   */
  async getMemberRole(roomId: string, userId: string): Promise<'admin' | 'member' | null> {
    const { memberService } = await import('./memberService.js');
    return memberService.getMemberRole(roomId, userId);
  }

  /**
   * @deprecated Use keyRotationService.getRoomKeyForVersion instead
   */
  async getRoomKeyForVersion(roomId: string, userId: string, version: number): Promise<string | null> {
    const { keyRotationService } = await import('./keyRotationService.js');
    return keyRotationService.getRoomKeyForVersion(roomId, userId, version);
  }

  /**
   * @deprecated Use keyRotationService.getRoomKeyHistory instead
   */
  async getRoomKeyHistory(roomId: string, userId: string) {
    const { keyRotationService } = await import('./keyRotationService.js');
    return keyRotationService.getRoomKeyHistory(roomId, userId);
  }

  /**
   * @deprecated Use memberService.getRoomMembers instead
   */
  async getRoomMembers(roomId: string) {
    const { memberService } = await import('./memberService.js');
    return memberService.getRoomMembers(roomId);
  }

  // ==========================================
  // PRIVATE HELPERS
  // ==========================================

  private async findExistingPrivateRoom(userId1: string, userId2: string) {
    // Find a private room where both users are members and there are exactly 2 members
    const rooms = await prisma.room.findMany({
      where: {
        isPrivate: true,
        AND: [
          { members: { some: { userId: userId1 } } },
          { members: { some: { userId: userId2 } } },
        ],
      },
      include: {
        _count: { select: { members: true } },
      },
    });

    // Return the room that has exactly 2 members
    return rooms.find((r) => r._count.members === 2) || null;
  }

  private formatRoomResponse(room: any) {
    return {
      id: room.id,
      name: room.name,
      isPrivate: room.isPrivate,
      photoUrl: room.photoUrl,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      members: room.members.map((m: any) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        photoUrl: m.user.photoUrl,
        state: m.user.state,
        role: m.role,
        publicKey: m.user.publicKey,
        encryptedRoomKey: m.encryptedRoomKey,
        keyVersion: m.keyVersion,
      })),
    };
  }
}

export const roomService = new RoomService();
export default roomService;
