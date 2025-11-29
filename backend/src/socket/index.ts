/**
 * Socket.IO Initialization
 *
 * Main entry point for WebSocket functionality.
 * For specific functionality, see:
 * - auth.ts - Authentication middleware
 * - emitters.ts - Event emitters for broadcasting
 * - handlers.ts - Event handlers for incoming messages
 */

import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { redisHelpers } from '../config/redis.js';

import { AuthenticatedSocket, socketAuthMiddleware } from './auth.js';
import { setIO, emitPresenceUpdate } from './emitters.js';
import { setupSocketHandlers } from './handlers.js';

// Re-export all emitters for backward compatibility
export {
  getIO,
  emitMemberAdded,
  emitMemberRemoved,
  emitMemberLeft,
  emitRoleChanged,
  emitRoomKeyRotated,
  emitGroupUpdated,
  emitGroupDeleted,
  emitGroupCreated,
  emitNewMessage,
  emitMessageDeleted,
  emitPresenceUpdate,
  GroupEventData,
} from './emitters.js';

export { AuthenticatedSocket } from './auth.js';

/**
 * Initialize Socket.IO server
 */
export const initializeSocket = (httpServer: HttpServer): SocketServer => {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Store IO instance for emitters
  setIO(io);

  // Set up authentication middleware
  io.use(socketAuthMiddleware);

  // Handle new connections
  io.on('connection', async (socket: AuthenticatedSocket) => {
    const user = socket.user!;
    logger.info(`User connected: ${user.email} (${socket.id})`);

    // Join user's personal room for direct notifications
    socket.join(`user:${user.id}`);

    // Set user online
    await redisHelpers.setUserOnline(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { state: 'online' },
    });

    // Broadcast presence update
    emitPresenceUpdate({
      userId: user.id,
      state: 'online',
      lastSeen: new Date().toISOString(),
    });

    // Set up event handlers
    setupSocketHandlers(socket, io);
  });

  return io;
};

export default initializeSocket;
