/**
 * Group Settings Service
 *
 * Handles group-level settings and operations including
 * group name, photo, and deletion.
 */

import { prisma } from '../config/database.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../middleware/errorHandler.js';

export class GroupSettingsService {
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
   * Delete a room (legacy - for private chats)
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

  /**
   * Format room response
   */
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

export const groupSettingsService = new GroupSettingsService();
export default groupSettingsService;
