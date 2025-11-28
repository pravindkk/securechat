import { createServer } from 'http';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { prisma, connectMongoDB, disconnectDatabases } from './config/database.js';
import { getRedisClient } from './config/redis.js';
import { initializeSocket } from './socket/index.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    // Connect to databases
    logger.info('Connecting to databases...');
    await prisma.$connect();
    logger.info('PostgreSQL connected');

    await connectMongoDB();

    // Initialize Redis
    getRedisClient();

    // Create Express app
    const app = createApp();

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize Socket.IO
    initializeSocket(httpServer);
    logger.info('Socket.IO initialized');

    // Start server
    httpServer.listen(config.port, () => {
      logger.info(`🚀 Server running on port ${config.port}`);
      logger.info(`📊 Environment: ${config.env}`);
      logger.info(`🔒 CORS origin: ${config.corsOrigin}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      httpServer.close();
      await disconnectDatabases();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
