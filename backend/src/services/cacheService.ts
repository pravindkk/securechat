/**
 * Cache Service
 *
 * Redis-based caching for frequently accessed data.
 * Reduces database load and improves response times.
 */

import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

// Cache TTL constants (in seconds)
const CACHE_TTL = {
  USER_PROFILE: 300, // 5 minutes
  ROOM_MEMBERS: 120, // 2 minutes
  USER_CHATS: 60, // 1 minute
  USER_PUBLIC_KEY: 600, // 10 minutes
  ROOM_MEMBERSHIP: 300, // 5 minutes
};

interface CacheOptions {
  ttlSeconds?: number;
  prefix?: string;
}

export class CacheService {
  /**
   * Get value from cache
   */
  async get<T>(key: string, prefix: string = ''): Promise<T | null> {
    try {
      const redis = getRedisClient();
      const fullKey = prefix ? `cache:${prefix}:${key}` : `cache:${key}`;
      const data = await redis.get(fullKey);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as T;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const redis = getRedisClient();
      const { ttlSeconds = 300, prefix = '' } = options;
      const fullKey = prefix ? `cache:${prefix}:${key}` : `cache:${key}`;

      await redis.setex(fullKey, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error('Cache set error:', error);
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string, prefix: string = ''): Promise<void> {
    try {
      const redis = getRedisClient();
      const fullKey = prefix ? `cache:${prefix}:${key}` : `cache:${key}`;
      await redis.del(fullKey);
    } catch (error) {
      logger.error('Cache delete error:', error);
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const keys = await redis.keys(`cache:${pattern}`);

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error('Cache delete pattern error:', error);
    }
  }

  /**
   * Get or set with callback (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key, options.prefix);

    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    await this.set(key, data, options);

    return data;
  }

  // ==========================================
  // SPECIALIZED CACHE METHODS
  // ==========================================

  /**
   * Cache user public key
   */
  async cacheUserPublicKey(userId: string, publicKey: string): Promise<void> {
    await this.set(`publicKey:${userId}`, publicKey, {
      ttlSeconds: CACHE_TTL.USER_PUBLIC_KEY,
      prefix: 'user',
    });
  }

  /**
   * Get cached user public key
   */
  async getUserPublicKey(userId: string): Promise<string | null> {
    return this.get<string>(`publicKey:${userId}`, 'user');
  }

  /**
   * Cache room membership check result
   */
  async cacheRoomMembership(
    roomId: string,
    userId: string,
    isMember: boolean
  ): Promise<void> {
    await this.set(`membership:${roomId}:${userId}`, isMember, {
      ttlSeconds: CACHE_TTL.ROOM_MEMBERSHIP,
      prefix: 'room',
    });
  }

  /**
   * Get cached room membership
   */
  async getRoomMembership(
    roomId: string,
    userId: string
  ): Promise<boolean | null> {
    return this.get<boolean>(`membership:${roomId}:${userId}`, 'room');
  }

  /**
   * Invalidate room membership cache
   */
  async invalidateRoomMembership(roomId: string): Promise<void> {
    await this.delPattern(`room:membership:${roomId}:*`);
  }

  /**
   * Cache user profile
   */
  async cacheUserProfile(
    userId: string,
    profile: {
      id: string;
      name: string | null;
      email: string;
      photoUrl: string | null;
      state: string;
    }
  ): Promise<void> {
    await this.set(`profile:${userId}`, profile, {
      ttlSeconds: CACHE_TTL.USER_PROFILE,
      prefix: 'user',
    });
  }

  /**
   * Get cached user profile
   */
  async getUserProfile(userId: string): Promise<{
    id: string;
    name: string | null;
    email: string;
    photoUrl: string | null;
    state: string;
  } | null> {
    return this.get(`profile:${userId}`, 'user');
  }

  /**
   * Invalidate user profile cache
   */
  async invalidateUserProfile(userId: string): Promise<void> {
    await this.del(`profile:${userId}`, 'user');
  }

  /**
   * Cache room members list
   */
  async cacheRoomMembers(roomId: string, members: unknown[]): Promise<void> {
    await this.set(`members:${roomId}`, members, {
      ttlSeconds: CACHE_TTL.ROOM_MEMBERS,
      prefix: 'room',
    });
  }

  /**
   * Get cached room members
   */
  async getRoomMembers(roomId: string): Promise<unknown[] | null> {
    return this.get<unknown[]>(`members:${roomId}`, 'room');
  }

  /**
   * Invalidate room members cache
   */
  async invalidateRoomMembers(roomId: string): Promise<void> {
    await this.del(`members:${roomId}`, 'room');
  }

  /**
   * Invalidate all room-related caches
   */
  async invalidateRoomCache(roomId: string): Promise<void> {
    await Promise.all([
      this.invalidateRoomMembers(roomId),
      this.invalidateRoomMembership(roomId),
    ]);
  }

  /**
   * Cache user's chat list
   */
  async cacheUserChats(userId: string, chats: unknown[]): Promise<void> {
    await this.set(`chats:${userId}`, chats, {
      ttlSeconds: CACHE_TTL.USER_CHATS,
      prefix: 'user',
    });
  }

  /**
   * Get cached user chats
   */
  async getUserChats(userId: string): Promise<unknown[] | null> {
    return this.get<unknown[]>(`chats:${userId}`, 'user');
  }

  /**
   * Invalidate user chats cache
   */
  async invalidateUserChats(userId: string): Promise<void> {
    await this.del(`chats:${userId}`, 'user');
  }

  /**
   * Invalidate chats cache for multiple users
   */
  async invalidateMultipleUserChats(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((id) => this.invalidateUserChats(id)));
  }
}

export const cacheService = new CacheService();
export default cacheService;
