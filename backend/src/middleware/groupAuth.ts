import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware to verify user is a member of the room
 * Requires :id param in route for roomId
 */
export const requireRoomMember = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (!roomId) {
      res.status(400).json({ success: false, error: 'Room ID required' });
      return;
    }

    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
      select: { id: true, role: true },
    });

    if (!member) {
      res.status(403).json({ success: false, error: 'Not a member of this room' });
      return;
    }

    // Attach member info to request for downstream use
    (req as AuthenticatedRequest & { roomMember: { id: string; role: string } }).roomMember = member;

    next();
  } catch (error) {
    logger.error('requireRoomMember middleware error:', error);
    res.status(500).json({ success: false, error: 'Authorization error' });
  }
};

/**
 * Middleware to verify user is an admin of the room
 * Requires :id param in route for roomId
 */
export const requireRoomAdmin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (!roomId) {
      res.status(400).json({ success: false, error: 'Room ID required' });
      return;
    }

    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
      select: { id: true, role: true },
    });

    if (!member) {
      res.status(403).json({ success: false, error: 'Not a member of this room' });
      return;
    }

    if (member.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Admin privileges required' });
      return;
    }

    // Attach member info to request for downstream use
    (req as AuthenticatedRequest & { roomMember: { id: string; role: string } }).roomMember = member;

    next();
  } catch (error) {
    logger.error('requireRoomAdmin middleware error:', error);
    res.status(500).json({ success: false, error: 'Authorization error' });
  }
};

/**
 * Middleware to verify the room is a group (not private 1-on-1)
 * Should be used after requireRoomMember or requireRoomAdmin
 * Requires :id param in route for roomId
 */
export const requireGroupRoom = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const roomId = req.params.id;

    if (!roomId) {
      res.status(400).json({ success: false, error: 'Room ID required' });
      return;
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { isPrivate: true },
    });

    if (!room) {
      res.status(404).json({ success: false, error: 'Room not found' });
      return;
    }

    if (room.isPrivate) {
      res.status(400).json({ success: false, error: 'This operation is only available for group chats' });
      return;
    }

    next();
  } catch (error) {
    logger.error('requireGroupRoom middleware error:', error);
    res.status(500).json({ success: false, error: 'Authorization error' });
  }
};

export default {
  requireRoomMember,
  requireRoomAdmin,
  requireGroupRoom,
};
