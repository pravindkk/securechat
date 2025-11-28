import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../middleware/errorHandler.js';
import { rsaEncrypt, generateRoomKey, sanitizeUser } from '../utils/helpers.js';
import { userService } from './userService.js';

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

    // Get public keys for all members
    const publicKeys = await userService.getMultipleUsersPublicKeys(allMemberIds);

    // Create room
    const room = await prisma.room.create({
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

    // Create user chat entries
    for (const memberId of allMemberIds) {
      const otherMember = isPrivate
        ? allMemberIds.find((id) => id !== memberId)
        : null;

      await prisma.userChat.create({
        data: {
          userId: memberId,
          roomId: room.id,
          otherUserId: otherMember,
        },
      });
    }

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
   * Get user's room key
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
   * Check if user is member of room
   */
  async isMember(roomId: string, userId: string): Promise<boolean> {
    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
    });
    return !!member;
  }

  /**
   * Delete a room
   */
  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    if (room.createdBy !== userId) {
      throw new ForbiddenError('Only room creator can delete the room');
    }

    await prisma.room.delete({
      where: { id: roomId },
    });
  }

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
      })),
    };
  }
}

export const roomService = new RoomService();
export default roomService;
