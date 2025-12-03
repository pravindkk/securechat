const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Store io instance globally for API routes to access
  global.io = io;

  // Track connected users and their rooms
  const userSockets = new Map(); // userId -> Set<socketId>
  const socketUsers = new Map(); // socketId -> userId

  io.on('connection', (socket) => {
    console.log('[Socket.IO] Client connected:', socket.id);

    // Authenticate user
    socket.on('authenticate', (data) => {
      const { userId } = data;
      if (userId) {
        socketUsers.set(socket.id, userId);
        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        console.log(`[Socket.IO] User ${userId} authenticated on socket ${socket.id}`);
      }
    });

    // Join a room
    socket.on('join-room', (data) => {
      const { roomId } = data;
      if (roomId) {
        socket.join(`room:${roomId}`);
        console.log(`[Socket.IO] Socket ${socket.id} joined room:${roomId}`);
      }
    });

    // Leave a room
    socket.on('leave-room', (data) => {
      const { roomId } = data;
      if (roomId) {
        socket.leave(`room:${roomId}`);
        console.log(`[Socket.IO] Socket ${socket.id} left room:${roomId}`);
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const { roomId, userId, isTyping } = data;
      socket.to(`room:${roomId}`).emit('typing', { roomId, userId, isTyping });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      const userId = socketUsers.get(socket.id);
      if (userId) {
        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            userSockets.delete(userId);
          }
        }
        socketUsers.delete(socket.id);
        console.log(`[Socket.IO] User ${userId} disconnected from socket ${socket.id}`);
      }
      console.log('[Socket.IO] Client disconnected:', socket.id);
    });
  });

  // Helper function to emit to a room (accessible from API routes via global.io)
  global.emitToRoom = (roomId, event, data) => {
    io.to(`room:${roomId}`).emit(event, data);
  };

  // Helper function to emit to a specific user
  global.emitToUser = (userId, event, data) => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.forEach((socketId) => {
        io.to(socketId).emit(event, data);
      });
    }
  };

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO server running`);
  });
});
