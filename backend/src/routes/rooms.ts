import { Router, Response } from 'express';
import { roomService } from '../services/roomService.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, createRoomSchema } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../types/index.js';

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

export default router;
