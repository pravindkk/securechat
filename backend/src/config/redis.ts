import Redis from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });
  }
  return redisClient;
}

export const redisHelpers = {
  async setWithExpiry(key: string, value: string, expirySeconds: number): Promise<void> {
    const client = getRedisClient();
    await client.setex(key, expirySeconds, value);
  },

  async get(key: string): Promise<string | null> {
    const client = getRedisClient();
    return client.get(key);
  },

  async del(key: string): Promise<void> {
    const client = getRedisClient();
    await client.del(key);
  },

  async setUserOnline(userId: string): Promise<void> {
    const client = getRedisClient();
    await client.sadd('online_users', userId);
  },

  async setUserOffline(userId: string): Promise<void> {
    const client = getRedisClient();
    await client.srem('online_users', userId);
  },

  async isUserOnline(userId: string): Promise<boolean> {
    const client = getRedisClient();
    return (await client.sismember('online_users', userId)) === 1;
  },
};

export default getRedisClient;
