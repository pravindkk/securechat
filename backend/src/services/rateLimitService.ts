/**
 * Rate Limit Service
 *
 * Redis-based rate limiting for API endpoints.
 * Provides sliding window and fixed window rate limiting.
 */

import { getRedisClient } from '../config/redis.js';
import { TooManyRequestsError } from '../middleware/errorHandler.js';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

export class RateLimitService {
  /**
   * Check rate limit using sliding window algorithm
   * @param key - Unique identifier (e.g., "otp:user@example.com")
   * @param limit - Maximum requests allowed
   * @param windowMs - Time window in milliseconds
   * @returns Rate limit result
   */
  async checkSlidingWindow(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - windowMs;
    const fullKey = `ratelimit:${key}`;

    // Use Redis transaction for atomic operations
    const multi = redis.multi();

    // Remove old entries outside the window
    multi.zremrangebyscore(fullKey, 0, windowStart);

    // Count current entries in window
    multi.zcard(fullKey);

    // Add current request
    multi.zadd(fullKey, now, `${now}-${Math.random()}`);

    // Set expiry on the key
    multi.pexpire(fullKey, windowMs);

    const results = await multi.exec();

    // Get the count (second command result)
    const count = results?.[1]?.[1] as number || 0;

    if (count >= limit) {
      // Get oldest entry to calculate reset time
      const oldest = await redis.zrange(fullKey, 0, 0, 'WITHSCORES');
      const oldestTime = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
      const resetAt = oldestTime + windowMs;
      const retryAfterSeconds = Math.ceil((resetAt - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remaining: limit - count - 1,
      resetAt: now + windowMs,
    };
  }

  /**
   * Check lockout status and attempts for verification
   * @param key - Unique identifier (e.g., "verify:user@example.com")
   * @param maxAttempts - Maximum failed attempts before lockout
   * @param lockoutMs - Lockout duration in milliseconds
   */
  async checkLockout(
    key: string,
    maxAttempts: number,
    lockoutMs: number
  ): Promise<{ locked: boolean; attempts: number; remainingMs?: number }> {
    const redis = getRedisClient();
    const fullKey = `lockout:${key}`;

    const data = await redis.get(fullKey);

    if (!data) {
      return { locked: false, attempts: 0 };
    }

    const { count, lockedUntil } = JSON.parse(data);
    const now = Date.now();

    // Check if currently locked out
    if (lockedUntil && now < lockedUntil) {
      return {
        locked: true,
        attempts: count,
        remainingMs: lockedUntil - now,
      };
    }

    // Lockout expired, reset
    if (lockedUntil && now >= lockedUntil) {
      await redis.del(fullKey);
      return { locked: false, attempts: 0 };
    }

    return { locked: false, attempts: count };
  }

  /**
   * Record a failed attempt and potentially trigger lockout
   * @param key - Unique identifier
   * @param maxAttempts - Maximum attempts before lockout
   * @param lockoutMs - Lockout duration in milliseconds
   * @param windowMs - Window to track attempts
   */
  async recordFailedAttempt(
    key: string,
    maxAttempts: number,
    lockoutMs: number,
    windowMs: number = lockoutMs
  ): Promise<{ newCount: number; locked: boolean }> {
    const redis = getRedisClient();
    const fullKey = `lockout:${key}`;

    const data = await redis.get(fullKey);
    let count = 1;
    let lockedUntil: number | null = null;

    if (data) {
      const parsed = JSON.parse(data);
      count = parsed.count + 1;
    }

    // Check if we need to trigger lockout
    if (count >= maxAttempts) {
      lockedUntil = Date.now() + lockoutMs;
    }

    // Store updated data
    await redis.setex(
      fullKey,
      Math.ceil(windowMs / 1000),
      JSON.stringify({ count, lockedUntil })
    );

    return { newCount: count, locked: !!lockedUntil };
  }

  /**
   * Clear failed attempts (call on successful verification)
   * @param key - Unique identifier
   */
  async clearAttempts(key: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`lockout:${key}`);
  }

  /**
   * Increment a counter with expiry
   * Simple fixed window rate limiting
   */
  async incrementCounter(
    key: string,
    windowSeconds: number
  ): Promise<number> {
    const redis = getRedisClient();
    const fullKey = `counter:${key}`;

    const multi = redis.multi();
    multi.incr(fullKey);
    multi.expire(fullKey, windowSeconds);

    const results = await multi.exec();
    return results?.[0]?.[1] as number || 1;
  }

  /**
   * Get current counter value
   */
  async getCounter(key: string): Promise<number> {
    const redis = getRedisClient();
    const value = await redis.get(`counter:${key}`);
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Enforce rate limit with automatic error throwing
   */
  async enforceLimit(
    key: string,
    limit: number,
    windowMs: number,
    errorMessage: string = 'Too many requests. Please try again later.'
  ): Promise<void> {
    const result = await this.checkSlidingWindow(key, limit, windowMs);

    if (!result.allowed) {
      throw new TooManyRequestsError(
        `${errorMessage} Try again in ${result.retryAfterSeconds} seconds.`
      );
    }
  }

  /**
   * Enforce lockout with automatic error throwing
   */
  async enforceLockout(
    key: string,
    maxAttempts: number,
    lockoutMs: number,
    errorMessage: string = 'Too many failed attempts.'
  ): Promise<void> {
    const result = await this.checkLockout(key, maxAttempts, lockoutMs);

    if (result.locked) {
      const remainingMinutes = Math.ceil((result.remainingMs || 0) / 60000);
      throw new TooManyRequestsError(
        `${errorMessage} Please try again in ${remainingMinutes} minutes.`
      );
    }
  }
}

export const rateLimitService = new RateLimitService();
export default rateLimitService;
