import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AuthenticatedRequest, UserPayload } from '../types/index.js';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as UserPayload & { exp: number };

      // Verify user still exists
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true },
      });

      if (!user) {
        res.status(401).json({ success: false, error: 'User not found' });
        return;
      }

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
      };

      next();
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({ success: false, error: 'Token expired' });
        return;
      }
      if (jwtError instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ success: false, error: 'Invalid token' });
        return;
      }
      throw jwtError;
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ success: false, error: 'Authentication error' });
  }
};

export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as UserPayload;

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true },
      });

      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      }
    } catch {
      // Token invalid, continue without auth
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next();
  }
};

export default authMiddleware;
