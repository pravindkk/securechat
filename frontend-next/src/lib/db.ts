import { PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';

// Prisma Client singleton for PostgreSQL
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// MongoDB connection for messages
const globalForMongo = globalThis as unknown as {
  mongoConn: typeof mongoose | null;
  mongoPromise: Promise<typeof mongoose> | null;
};

export async function connectMongoDB(): Promise<typeof mongoose> {
  if (globalForMongo.mongoConn) {
    return globalForMongo.mongoConn;
  }

  if (!globalForMongo.mongoPromise) {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable not set');
    }

    globalForMongo.mongoPromise = mongoose.connect(mongoUri);
  }

  globalForMongo.mongoConn = await globalForMongo.mongoPromise;
  return globalForMongo.mongoConn;
}

export default prisma;
