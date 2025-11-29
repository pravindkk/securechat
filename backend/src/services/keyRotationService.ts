/**
 * Key Rotation Service
 *
 * Handles encryption key management including key rotation,
 * historical key retrieval, and key version tracking.
 */

import { prisma } from '../config/database.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../middleware/errorHandler.js';

export class KeyRotationService {
  /**
   * Rotate room key with new encrypted keys for all members
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
   * Get user's current room key
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
   * Check if user is admin of room
   */
  private async isAdmin(roomId: string, userId: string): Promise<boolean> {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    return member?.role === 'admin';
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

export const keyRotationService = new KeyRotationService();
export default keyRotationService;
