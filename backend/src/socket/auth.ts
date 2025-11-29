/**
 * Socket Authentication Middleware
 *
 * Handles JWT token verification for socket connections.
 */

import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { UserPayload } from '../types/index.js';

export interface AuthenticatedSocket extends Socket {
  user?: UserPayload;
}

/**
 * Socket authentication middleware
 * Verifies JWT token and attaches user to socket
 */
export const socketAuthMiddleware = async (
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
) => {
  try {
    const token =
      socket.handshake.auth.token ||
      socket.handshake.headers.authorization?.split(' ')[1];

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
};

export default socketAuthMiddleware;
