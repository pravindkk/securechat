import { PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

export const prisma = new PrismaClient({
  log: config.env === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export async function connectMongoDB(): Promise<void> {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function disconnectDatabases(): Promise<void> {
  await prisma.$disconnect();
  await mongoose.disconnect();
  logger.info('Databases disconnected');
}
