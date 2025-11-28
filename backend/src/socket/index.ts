import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { redisHelpers } from '../config/redis.js';
import { roomService } from '../services/roomService.js';
import { UserPayload } from '../types/index.js';

interface AuthenticatedSocket extends Socket {
  user?: UserPayload;
}

let ioInstance: SocketServer | null = null;

export const getIO = (): SocketServer => {
  if (!ioInstance) {
    throw new Error('Socket.IO not initialized');
  }
  return ioInstance;
};

// ==========================================
// GROUP EVENT EMITTERS
// ==========================================

export interface GroupEventData {
  roomId: string;
  [key: string]: unknown;
}

/**
 * Emit event when a member is added to a group
 * FIX-8: Also notify the new member directly since they haven't joined the room channel yet
 */
export const emitMemberAdded = (data: {
  roomId: string;
  member: {
    id: string;
    name: string | null;
    email: string;
    photoUrl: string | null;
    role: string;
    publicKey: string;
    keyVersion: number;
  };
  addedBy: { id: string; name: string };
}) => {
  const io = getIO();
  // Notify existing room members
  io.to(`room:${data.roomId}`).emit('member_added', data);
  // Also notify the new member directly (they haven't joined the room channel yet)
  io.to(`user:${data.member.id}`).emit('member_added', data);
};

/**
 * Emit event when a member is removed from a group
 */
export const emitMemberRemoved = (data: {
  roomId: string;
  memberId: string;
  removedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('member_removed', data);
  // Also notify the removed user directly
  io.to(`user:${data.memberId}`).emit('removed_from_room', {
    roomId: data.roomId,
  });
};

/**
 * Emit event when a member leaves a group
 */
export const emitMemberLeft = (data: {
  roomId: string;
  memberId: string;
  memberName: string;
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('member_left', data);
};

/**
 * Emit event when a member's role changes
 */
export const emitRoleChanged = (data: {
  roomId: string;
  memberId: string;
  newRole: 'admin' | 'member';
  changedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('role_changed', data);
};

/**
 * Emit event when room key is rotated
 * Sends each member their own encrypted key
 */
export const emitRoomKeyRotated = (data: {
  roomId: string;
  newKeyVersion: number;
  encryptedKeys: Record<string, string>; // userId -> encryptedKey
}) => {
  const io = getIO();
  // Send each user their specific encrypted key
  for (const [userId, encryptedKey] of Object.entries(data.encryptedKeys)) {
    io.to(`user:${userId}`).emit('room_key_rotated', {
      roomId: data.roomId,
      newKeyVersion: data.newKeyVersion,
      encryptedKey,
    });
  }
};

/**
 * Emit event when group details are updated
 */
export const emitGroupUpdated = (data: {
  roomId: string;
  changes: { name?: string; photoUrl?: string | null };
  updatedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('group_updated', data);
};

/**
 * Emit event when a group is deleted
 */
export const emitGroupDeleted = (data: {
  roomId: string;
  deletedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('group_deleted', data);
};

/**
 * Emit event when a group is created
 * Notifies each member directly since they haven't joined the room channel yet
 */
export const emitGroupCreated = (data: {
  roomId: string;
  room: {
    id: string;
    name: string;
    members: Array<{ id: string; name: string | null; email: string }>;
  };
  createdBy: { id: string; name: string };
}) => {
  const io = getIO();
  // Notify each member directly since they haven't joined the room channel yet
  for (const member of data.room.members) {
    io.to(`user:${member.id}`).emit('group_created', data);
  }
};

export const initializeSocket = (httpServer: HttpServer): SocketServer => {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  ioInstance = io;

  // Middleware for authentication
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret) as UserPayload;

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true },
      });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const user = socket.user!;
    logger.info(`User connected: ${user.email} (${socket.id})`);

    // Track rooms where user is currently typing (for cleanup on disconnect)
    const typingRooms = new Set<string>();

    // Join user's personal room for direct notifications
    socket.join(`user:${user.id}`);

    // Set user online
    await redisHelpers.setUserOnline(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { state: 'online' },
    });

    // Broadcast presence update
    io.emit('presence_update', {
      userId: user.id,
      state: 'online',
      lastSeen: new Date().toISOString(),
    });

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

    // Handle mark as read
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

    // Handle presence update
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

        io.emit('presence_update', {
          userId: user.id,
          state,
          lastSeen: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Error updating presence:', error);
      }
    });

    // Handle disconnect
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

        io.emit('presence_update', {
          userId: user.id,
          state: 'offline',
          lastSeen: new Date().toISOString(),
        });
      }
    });
  });

  return io;
};

export default initializeSocket;
