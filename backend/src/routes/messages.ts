import { Router, Response } from 'express';
import { messageService } from '../services/messageService.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, sendMessageSchema, getMessagesSchema } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../types/index.js';
import { getIO } from '../socket/index.js';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/messages/:roomId
 * Get messages for a room
 */
router.get(
  '/:roomId',
  authMiddleware,
  validate(getMessagesSchema),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { limit, before } = req.query as { limit?: number; before?: string };
      const result = await messageService.getMessages(
        req.params.roomId,
        req.user!.id,
        limit || 50,
        before
      );
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
 * POST /api/messages/:roomId
 * Send a message to a room
 */
router.post(
  '/:roomId',
  authMiddleware,
  validate(sendMessageSchema),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { encryptedContent, iv, authTag, type, mediaUrl, mediaType } = req.body;
      const roomId = req.params.roomId;
      const senderId = req.user!.id;

      const message = await messageService.createMessage(roomId, senderId, {
        encryptedContent,
        iv,
        authTag,
        type,
        mediaUrl,
        mediaType,
      });

      // Get sender info
      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { id: true, name: true, photoUrl: true },
      });

      // Broadcast to room via socket
      try {
        const io = getIO();
        io.to(`room:${roomId}`).emit('new_message', {
          message: {
            ...message.toObject(),
            sender,
          },
        });

        // Send unread count updates to other room members
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: { members: true },
        });

        if (room) {
          for (const member of room.members) {
            if (member.userId !== senderId) {
              const userChat = await prisma.userChat.findUnique({
                where: {
                  userId_roomId: {
                    userId: member.userId,
                    roomId,
                  },
                },
              });

              if (userChat) {
                io.to(`user:${member.userId}`).emit('unread_count_update', {
                  roomId,
                  count: userChat.unreadCount,
                });
              }
            }
          }
        }
      } catch (socketError) {
        console.error('Socket broadcast failed:', socketError);
      }

      res.status(201).json({
        success: true,
        data: { message },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/messages/:messageId
 * Delete a message
 */
router.delete(
  '/:messageId',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      await messageService.deleteMessage(req.params.messageId, req.user!.id);
      res.json({
        success: true,
        message: 'Message deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
