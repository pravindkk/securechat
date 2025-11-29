/**
 * Socket Event Handlers
 *
 * Handles incoming socket events from clients including
 * room management, typing indicators, and presence updates.
 */

import { Server as SocketServer } from 'socket.io';
import { AuthenticatedSocket } from './auth.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { redisHelpers } from '../config/redis.js';
import { roomService } from '../services/roomService.js';
import { emitPresenceUpdate } from './emitters.js';

/**
 * Handle room-related events
 */
export const handleRoomEvents = (
  socket: AuthenticatedSocket,
  typingRooms: Set<string>
) => {
  const user = socket.user!;

  // Handle joining a room
  socket.on('join_room', async ({ roomId }) => {
    try {
      const isMember = await roomService.isMember(roomId, user.id);
      if (isMember) {
        socket.join(`room:${roomId}`);
        logger.debug(`User ${user.email} joined room ${roomId}`);
      }
    } catch (error) {
      logger.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle leaving a room
  socket.on('leave_room', ({ roomId }) => {
    socket.leave(`room:${roomId}`);
    // Clear typing state for this room
    if (typingRooms.has(roomId)) {
      typingRooms.delete(roomId);
      socket.to(`room:${roomId}`).emit('user_stop_typing', {
        roomId,
        userId: user.id,
      });
    }
    logger.debug(`User ${user.email} left room ${roomId}`);
  });
};

/**
 * Handle typing indicator events
 */
export const handleTypingEvents = (
  socket: AuthenticatedSocket,
  typingRooms: Set<string>
) => {
  const user = socket.user!;

  // Handle typing indicator
  socket.on('typing', async ({ roomId }) => {
    try {
      // Verify user is a member of this room before broadcasting
      const isMember = await roomService.isMember(roomId, user.id);
      if (!isMember) {
        return;
      }
      typingRooms.add(roomId);
      socket.to(`room:${roomId}`).emit('user_typing', {
        roomId,
        userId: user.id,
        userName: user.name || user.email,
      });
    } catch (error) {
      logger.error('Error handling typing event:', error);
    }
  });

  // Handle stop typing
  socket.on('stop_typing', async ({ roomId }) => {
    try {
      // Verify user is a member of this room before broadcasting
      const isMember = await roomService.isMember(roomId, user.id);
      if (!isMember) {
        return;
      }
      typingRooms.delete(roomId);
      socket.to(`room:${roomId}`).emit('user_stop_typing', {
        roomId,
        userId: user.id,
      });
    } catch (error) {
      logger.error('Error handling stop_typing event:', error);
    }
  });
};

/**
 * Handle message read events
 */
export const handleReadEvents = (socket: AuthenticatedSocket) => {
  const user = socket.user!;

  socket.on('mark_read', async ({ roomId }) => {
    try {
      await roomService.markAsRead(roomId, user.id);
      socket.to(`room:${roomId}`).emit('messages_read', {
        roomId,
        userId: user.id,
      });
    } catch (error) {
      logger.error('Error marking as read:', error);
    }
  });
};

/**
 * Handle presence update events
 */
export const handlePresenceEvents = (socket: AuthenticatedSocket) => {
  const user = socket.user!;

  socket.on('update_presence', async ({ state }) => {
    try {
      if (state === 'online') {
        await redisHelpers.setUserOnline(user.id);
      } else {
        await redisHelpers.setUserOffline(user.id);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          state,
          lastSeen: new Date(),
        },
      });

      emitPresenceUpdate({
        userId: user.id,
        state,
        lastSeen: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error updating presence:', error);
    }
  });
};

/**
 * Handle disconnect event
 */
export const handleDisconnect = (
  socket: AuthenticatedSocket,
  io: SocketServer,
  typingRooms: Set<string>
) => {
  const user = socket.user!;

  socket.on('disconnect', async () => {
    logger.info(`User disconnected: ${user.email}`);

    // Clear typing indicators for all rooms user was typing in
    for (const roomId of typingRooms) {
      socket.to(`room:${roomId}`).emit('user_stop_typing', {
        roomId,
        userId: user.id,
      });
    }
    typingRooms.clear();

    // Check if user has other active connections
    const sockets = await io.in(`user:${user.id}`).fetchSockets();
    if (sockets.length <= 1) {
      await redisHelpers.setUserOffline(user.id);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          state: 'offline',
          lastSeen: new Date(),
        },
      });

      emitPresenceUpdate({
        userId: user.id,
        state: 'offline',
        lastSeen: new Date().toISOString(),
      });
    }
  });
};

/**
 * Set up all event handlers for a connected socket
 */
export const setupSocketHandlers = (
  socket: AuthenticatedSocket,
  io: SocketServer
) => {
  // Track rooms where user is currently typing (for cleanup on disconnect)
  const typingRooms = new Set<string>();

  // Set up handlers
  handleRoomEvents(socket, typingRooms);
  handleTypingEvents(socket, typingRooms);
  handleReadEvents(socket);
  handlePresenceEvents(socket);
  handleDisconnect(socket, io, typingRooms);
};
