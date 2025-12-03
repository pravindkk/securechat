/**
 * JWT Authentication utilities
 */
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from './db';

export interface UserPayload {
  id: string;
  email: string;
  name: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production';
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '7d';

export function generateTokens(user: { id: string; email: string; name: string | null }): TokenPair {
  const payload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_EXPIRY,
  });

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  );

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): (UserPayload & { type: string }) | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as UserPayload & { type: string };
    if (decoded.type !== 'refresh') {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function getAuthUser(request: NextRequest): Promise<UserPayload | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  return verifyAccessToken(token);
}

export async function requireAuth(request: NextRequest): Promise<UserPayload> {
  const user = await getAuthUser(request);
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function getUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
  });
}
