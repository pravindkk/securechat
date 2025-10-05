const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store connected users
const users = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user
  socket.on('register', (username) => {
    users.set(username, socket.id);
    socket.username = username;
    console.log(`User registered: ${username}`);

    // Broadcast updated user list
    io.emit('users', Array.from(users.keys()));
  });

  // Handle key exchange
  socket.on('key-exchange', ({ to, publicKey, sharedSecret }) => {
    const recipientSocketId = users.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('key-exchange', {
        from: socket.username,
        publicKey,
        sharedSecret
      });
      console.log(`Key exchange from ${socket.username} to ${to}`);
    }
  });

  // Handle key exchange response
  socket.on('key-exchange-response', ({ to, publicKey }) => {
    const recipientSocketId = users.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('key-exchange-response', {
        from: socket.username,
        publicKey
      });
      console.log(`Key exchange response from ${socket.username} to ${to}`);
    }
  });

  // Handle encrypted messages
  socket.on('message', ({ to, encryptedMessage }) => {
    const recipientSocketId = users.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('message', {
        from: socket.username,
        encryptedMessage,
        timestamp: Date.now()
      });
      console.log(`Message from ${socket.username} to ${to}`);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.username) {
      users.delete(socket.username);
      io.emit('users', Array.from(users.keys()));
      console.log(`User disconnected: ${socket.username}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
