import { prisma } from '../config/database.js';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../middleware/errorHandler.js';
import { rsaEncrypt, generateRoomKey } from '../utils/helpers.js';
import { userService } from './userService.js';

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
   * Delete a room (legacy - use deleteGroupRoom for groups)
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

  // ==========================================
  // GROUP CHAT MANAGEMENT METHODS
  // ==========================================

  /**
   * Create a new group chat
   * FIX-7: Wrap room and UserChat creation in transaction for atomicity
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
    await prisma.$transaction(async (tx) => {
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
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Remove the member FIRST (before archiving)
      await tx.roomMember.delete({
        where: { roomId_userId: { roomId, userId: targetMemberId } },
      });

      // Step 2: Remove user chat entry
      await tx.userChat.deleteMany({
        where: { roomId, userId: targetMemberId },
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

    return result;
  }

  /**
   * Member leaves group voluntarily
   * FIX-6: Move room query inside transaction to prevent race condition with admin promotion
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

      // If user is admin, ensure at least one admin remains (using fresh data from transaction)
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

      // Archive current room key (after member removal, so leaving user's key is not in history)
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

    return result;
  }

  /**
   * Rotate room key with new encrypted keys for all members
   * FIX-3: Use transaction to ensure atomicity and get current version correctly
   */
  async rotateRoomKey(
    roomId: string,
    requesterId: string,
    encryptedKeys: Record<string, string>
  ) {
    // Verify requester is admin
    await this.requireAdmin(roomId, requesterId);

    // Use transaction to ensure atomicity and consistent version reading
    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { members: true },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      // Get the CURRENT version from the room (already incremented by removeMember)
      const currentKeyVersion = room.roomKeyVersion;

      // Update each member's encrypted room key with the CURRENT version
      for (const member of room.members) {
        const newEncryptedKey = encryptedKeys[member.userId];
        if (!newEncryptedKey) {
          throw new BadRequestError(`Missing encrypted key for member ${member.userId}`);
        }

        await tx.roomMember.update({
          where: { id: member.id },
          data: {
            encryptedRoomKey: newEncryptedKey,
            keyVersion: currentKeyVersion,
          },
        });
      }

      return { keyVersion: currentKeyVersion };
    });

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
   * FIX-5: Use transaction to prevent race condition where admin count changes between check and update
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
   * Update group details (admin only)
   */
  async updateGroupRoom(
    roomId: string,
    requesterId: string,
    data: { name?: string; photoUrl?: string | null }
  ) {
    await this.requireAdmin(roomId, requesterId);

    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    if (room.isPrivate) {
      throw new BadRequestError('Cannot update private chat details');
    }

    const updateData: { name?: string; photoUrl?: string | null } = {};
    if (data.name !== undefined) {
      if (!data.name || data.name.trim().length === 0) {
        throw new BadRequestError('Group name cannot be empty');
      }
      updateData.name = data.name.trim();
    }
    if (data.photoUrl !== undefined) {
      updateData.photoUrl = data.photoUrl;
    }

    const updatedRoom = await prisma.room.update({
      where: { id: roomId },
      data: updateData,
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

    return this.formatRoomResponse(updatedRoom);
  }

  /**
   * Delete a group (admin only)
   */
  async deleteGroupRoom(roomId: string, requesterId: string) {
    await this.requireAdmin(roomId, requesterId);

    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    if (room.isPrivate) {
      throw new BadRequestError('Use delete endpoint for private chats');
    }

    await prisma.room.delete({
      where: { id: roomId },
    });

    return { success: true };
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
   * Get room key for a specific version (for decrypting old messages)
   */
  async getRoomKeyForVersion(
    roomId: string,
    userId: string,
    version: number
  ): Promise<string | null> {
    // First check if this is the current version
    const currentMember = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { encryptedRoomKey: true, keyVersion: true },
    });

    if (!currentMember) {
      throw new ForbiddenError('Not a member of this room');
    }

    if (currentMember.keyVersion === version) {
      return currentMember.encryptedRoomKey;
    }

    // Look in key history
    const keyHistory = await prisma.roomKeyHistory.findUnique({
      where: { roomId_version: { roomId, version } },
      include: {
        memberKeys: {
          where: { userId },
        },
      },
    });

    if (!keyHistory || keyHistory.memberKeys.length === 0) {
      return null;
    }

    return keyHistory.memberKeys[0].encryptedRoomKey;
  }

  /**
   * Get all historical room keys for a user (for providing to new members)
   */
  async getRoomKeyHistory(
    roomId: string,
    userId: string
  ): Promise<{
    keyHistory: Array<{ version: number; encryptedRoomKey: string }>;
    currentVersion: number;
  }> {
    // Verify user is a member
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { encryptedRoomKey: true, keyVersion: true },
    });

    if (!member) {
      throw new ForbiddenError('Not a member of this room');
    }

    // Get room's current key version
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { roomKeyVersion: true },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    // Get all historical keys for this user
    const historyEntries = await prisma.roomKeyHistory.findMany({
      where: { roomId },
      include: {
        memberKeys: {
          where: { userId },
        },
      },
      orderBy: { version: 'asc' },
    });

    const keyHistory: Array<{ version: number; encryptedRoomKey: string }> = [];

    // Add historical keys
    for (const entry of historyEntries) {
      if (entry.memberKeys.length > 0) {
        keyHistory.push({
          version: entry.version,
          encryptedRoomKey: entry.memberKeys[0].encryptedRoomKey,
        });
      }
    }

    // Add current key if not already in history
    const currentInHistory = keyHistory.some((k) => k.version === room.roomKeyVersion);
    if (!currentInHistory) {
      keyHistory.push({
        version: member.keyVersion,
        encryptedRoomKey: member.encryptedRoomKey,
      });
    }

    return {
      keyHistory,
      currentVersion: room.roomKeyVersion,
    };
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
   * Helper to verify user is admin and throw if not
   */
  private async requireAdmin(roomId: string, userId: string) {
    const isAdmin = await this.isAdmin(roomId, userId);
    if (!isAdmin) {
      throw new ForbiddenError('Admin privileges required');
    }
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
        keyVersion: m.keyVersion,
      })),
    };
  }
}

export const roomService = new RoomService();
export default roomService;
