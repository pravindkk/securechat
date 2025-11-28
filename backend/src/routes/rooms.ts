import { Router, Response } from 'express';
import { roomService } from '../services/roomService.js';
import { messageService } from '../services/messageService.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRoomAdmin, requireRoomMember, requireGroupRoom } from '../middleware/groupAuth.js';
import {
  validate,
  createRoomSchema,
  createGroupRoomSchema,
  addMemberSchema,
  removeMemberSchema,
  memberActionSchema,
  updateGroupSchema,
  rotateKeySchema,
  getRoomKeyVersionSchema,
} from '../middleware/validation.js';
import { AuthenticatedRequest } from '../types/index.js';
import { prisma } from '../config/database.js';
import {
  emitMemberAdded,
  emitMemberRemoved,
  emitMemberLeft,
  emitRoleChanged,
  emitRoomKeyRotated,
  emitGroupUpdated,
  emitGroupDeleted,
  emitGroupCreated,
} from '../socket/index.js';

const router = Router();

/**
 * POST /api/rooms
 * Create a new room
 */
router.post(
  '/',
  authMiddleware,
  validate(createRoomSchema),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { memberIds, name, isPrivate } = req.body;
      const room = await roomService.createRoom(
        req.user!.id,
        memberIds,
        name,
        isPrivate ?? true
      );
      res.status(201).json({
        success: true,
        data: { room },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/rooms/chats
 * Get user's chats
 */
router.get(
  '/chats',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const chats = await roomService.getUserChats(req.user!.id);
      res.json({
        success: true,
        data: { chats },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/rooms/:id
 * Get room details
 */
router.get(
  '/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const room = await roomService.getRoomWithMembers(req.params.id);
      res.json({
        success: true,
        data: { room },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/rooms/:id/key
 * Get encrypted room key for current user
 */
router.get(
  '/:id/key',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const encryptedRoomKey = await roomService.getUserRoomKey(
        req.params.id,
        req.user!.id
      );
      res.json({
        success: true,
        data: { encryptedRoomKey },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/rooms/:id/read
 * Mark room as read
 */
router.post(
  '/:id/read',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      await roomService.markAsRead(req.params.id, req.user!.id);
      res.json({
        success: true,
        message: 'Marked as read',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/rooms/:id
 * Delete a room
 */
router.delete(
  '/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      await roomService.deleteRoom(req.params.id, req.user!.id);
      res.json({
        success: true,
        message: 'Room deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// GROUP CHAT ROUTES
// ==========================================

/**
 * POST /api/rooms/group
 * Create a new group chat
 */
router.post(
  '/group',
  authMiddleware,
  validate(createGroupRoomSchema),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { memberIds, name } = req.body;
      const room = await roomService.createGroupRoom(req.user!.id, memberIds, name);

      // Create system message for group creation
      await messageService.createSystemMessage(room.id, 'group_created', {
        actorId: req.user!.id,
        actorName: req.user!.name || req.user!.email,
      });

      // Emit socket event to notify all members about the new group
      emitGroupCreated({
        roomId: room.id,
        room: {
          id: room.id,
          name: room.name || '',
          members: room.members.map((m: { id: string; name: string | null; email: string }) => ({
            id: m.id,
            name: m.name,
            email: m.email,
          })),
        },
        createdBy: {
          id: req.user!.id,
          name: req.user!.name || req.user!.email,
        },
      });

      res.status(201).json({
        success: true,
        data: { room },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/rooms/:id/members
 * Add a member to a group (admin only)
 */
router.post(
  '/:id/members',
  authMiddleware,
  validate(addMemberSchema),
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { userId, encryptedRoomKey, historicalKeys } = req.body;
      const result = await roomService.addMember(
        req.params.id,
        req.user!.id,
        userId,
        encryptedRoomKey,
        historicalKeys
      );

      // Get the added user's full info and room's current key version
      const [addedUser, room] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, photoUrl: true, publicKey: true },
        }),
        prisma.room.findUnique({
          where: { id: req.params.id },
          select: { roomKeyVersion: true },
        }),
      ]);

      // Create system message
      await messageService.createSystemMessage(req.params.id, 'member_added', {
        actorId: req.user!.id,
        actorName: req.user!.name || req.user!.email,
        targetId: userId,
        targetName: addedUser?.name || addedUser?.email || 'Unknown',
      });

      // Emit socket event
      if (addedUser) {
        emitMemberAdded({
          roomId: req.params.id,
          member: {
            id: addedUser.id,
            name: addedUser.name,
            email: addedUser.email,
            photoUrl: addedUser.photoUrl,
            role: 'member',
            publicKey: addedUser.publicKey,
            keyVersion: room?.roomKeyVersion || 1,
          },
          addedBy: {
            id: req.user!.id,
            name: req.user!.name || req.user!.email,
          },
        });
      }

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/rooms/:id/members/:userId
 * Remove a member from a group (admin only)
 */
router.delete(
  '/:id/members/:userId',
  authMiddleware,
  validate(removeMemberSchema),
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Get the user's name before removing
      const removedUser = await prisma.user.findUnique({
        where: { id: req.params.userId },
        select: { name: true, email: true },
      });

      const result = await roomService.removeMember(
        req.params.id,
        req.user!.id,
        req.params.userId
      );

      // Create system message
      await messageService.createSystemMessage(req.params.id, 'member_removed', {
        actorId: req.user!.id,
        actorName: req.user!.name || req.user!.email,
        targetId: req.params.userId,
        targetName: removedUser?.name || removedUser?.email || 'Unknown',
      });

      // Emit socket event
      emitMemberRemoved({
        roomId: req.params.id,
        memberId: req.params.userId,
        removedBy: {
          id: req.user!.id,
          name: req.user!.name || req.user!.email,
        },
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/rooms/:id/leave
 * Leave a group voluntarily
 */
router.post(
  '/:id/leave',
  authMiddleware,
  requireRoomMember,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const result = await roomService.leaveRoom(req.params.id, req.user!.id);

      // Create system message and emit socket event if room wasn't deleted
      if (!result.roomDeleted) {
        await messageService.createSystemMessage(req.params.id, 'member_left', {
          actorId: req.user!.id,
          actorName: req.user!.name || req.user!.email,
        });

        emitMemberLeft({
          roomId: req.params.id,
          memberId: req.user!.id,
          memberName: req.user!.name || req.user!.email,
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/rooms/:id/members/:userId/promote
 * Promote a member to admin
 */
router.post(
  '/:id/members/:userId/promote',
  authMiddleware,
  validate(memberActionSchema),
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      await roomService.promoteMember(req.params.id, req.user!.id, req.params.userId);

      // Get the promoted user's name
      const promotedUser = await prisma.user.findUnique({
        where: { id: req.params.userId },
        select: { name: true, email: true },
      });

      // Create system message
      await messageService.createSystemMessage(req.params.id, 'admin_promoted', {
        actorId: req.user!.id,
        actorName: req.user!.name || req.user!.email,
        targetId: req.params.userId,
        targetName: promotedUser?.name || promotedUser?.email || 'Unknown',
      });

      // Emit socket event
      emitRoleChanged({
        roomId: req.params.id,
        memberId: req.params.userId,
        newRole: 'admin',
        changedBy: {
          id: req.user!.id,
          name: req.user!.name || req.user!.email,
        },
      });

      res.json({
        success: true,
        message: 'Member promoted to admin',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/rooms/:id/members/:userId/demote
 * Demote an admin to member
 */
router.post(
  '/:id/members/:userId/demote',
  authMiddleware,
  validate(memberActionSchema),
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      await roomService.demoteMember(req.params.id, req.user!.id, req.params.userId);

      // Get the demoted user's name
      const demotedUser = await prisma.user.findUnique({
        where: { id: req.params.userId },
        select: { name: true, email: true },
      });

      // Create system message
      await messageService.createSystemMessage(req.params.id, 'admin_demoted', {
        actorId: req.user!.id,
        actorName: req.user!.name || req.user!.email,
        targetId: req.params.userId,
        targetName: demotedUser?.name || demotedUser?.email || 'Unknown',
      });

      // Emit socket event
      emitRoleChanged({
        roomId: req.params.id,
        memberId: req.params.userId,
        newRole: 'member',
        changedBy: {
          id: req.user!.id,
          name: req.user!.name || req.user!.email,
        },
      });

      res.json({
        success: true,
        message: 'Admin demoted to member',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/rooms/:id
 * Update group details (admin only)
 */
router.patch(
  '/:id',
  authMiddleware,
  validate(updateGroupSchema),
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { name, photoUrl } = req.body;

      // Get old values for system message
      const oldRoom = await prisma.room.findUnique({
        where: { id: req.params.id },
        select: { name: true, photoUrl: true },
      });

      const room = await roomService.updateGroupRoom(req.params.id, req.user!.id, {
        name,
        photoUrl,
      });

      // Create system messages for changes
      if (name && oldRoom?.name !== name) {
        await messageService.createSystemMessage(req.params.id, 'group_name_changed', {
          actorId: req.user!.id,
          actorName: req.user!.name || req.user!.email,
          oldValue: oldRoom?.name || undefined,
          newValue: name,
        });
      }

      if (photoUrl !== undefined && oldRoom?.photoUrl !== photoUrl) {
        await messageService.createSystemMessage(req.params.id, 'group_photo_changed', {
          actorId: req.user!.id,
          actorName: req.user!.name || req.user!.email,
        });
      }

      // Emit socket event
      emitGroupUpdated({
        roomId: req.params.id,
        changes: { name, photoUrl },
        updatedBy: {
          id: req.user!.id,
          name: req.user!.name || req.user!.email,
        },
      });

      res.json({
        success: true,
        data: { room },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/rooms/:id/key/:version
 * Get room key for a specific version (for decrypting old messages)
 */
router.get(
  '/:id/key/:version',
  authMiddleware,
  validate(getRoomKeyVersionSchema),
  requireRoomMember,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const version = parseInt(req.params.version, 10);
      const encryptedRoomKey = await roomService.getRoomKeyForVersion(
        req.params.id,
        req.user!.id,
        version
      );

      if (!encryptedRoomKey) {
        res.status(404).json({
          success: false,
          error: 'Key version not found',
        });
        return;
      }

      res.json({
        success: true,
        data: { encryptedRoomKey, version },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/rooms/:id/key-history
 * Get all historical room keys for the current user (for providing to new members)
 */
router.get(
  '/:id/key-history',
  authMiddleware,
  requireRoomMember,
  requireRoomAdmin, // Only admins can get key history (they need it to add members)
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { keyHistory, currentVersion } = await roomService.getRoomKeyHistory(
        req.params.id,
        req.user!.id
      );

      res.json({
        success: true,
        data: { keyHistory, currentVersion },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/rooms/:id/rotate-key
 * Submit rotated room keys for all members (admin only)
 */
router.post(
  '/:id/rotate-key',
  authMiddleware,
  validate(rotateKeySchema),
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { encryptedKeys } = req.body;
      const result = await roomService.rotateRoomKey(
        req.params.id,
        req.user!.id,
        encryptedKeys
      );

      // Emit socket event
      emitRoomKeyRotated({
        roomId: req.params.id,
        newKeyVersion: result.keyVersion,
        encryptedKeys,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/rooms/:id/members
 * Get all members of a room
 */
router.get(
  '/:id/members',
  authMiddleware,
  requireRoomMember,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const members = await roomService.getRoomMembers(req.params.id);
      res.json({
        success: true,
        data: { members },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/rooms/:id/group
 * Delete a group (admin only)
 */
router.delete(
  '/:id/group',
  authMiddleware,
  requireRoomAdmin,
  requireGroupRoom,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Delete group first - emit socket event only after successful deletion
      await roomService.deleteGroupRoom(req.params.id, req.user!.id);

      // Emit socket event after successful deletion
      emitGroupDeleted({
        roomId: req.params.id,
        deletedBy: {
          id: req.user!.id,
          name: req.user!.name || req.user!.email,
        },
      });

      res.json({
        success: true,
        message: 'Group deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
