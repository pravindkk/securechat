// server/index.js
require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const database = require('./database');
const authManager = require('./auth');
const MessageQueue = require('./messageQueue');
const { authenticateSocket, authenticateHTTP, rateLimit } = require('./middleware');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Initialize database
database.initialize().catch(console.error);

// Message queue
const messageQueue = new MessageQueue(io);

// REST API Routes
app.post('/auth/register', rateLimit(60000, 5), async (req, res) => {
    try {
        const { username, password, identityKey, signedPreKey, signedPreKeySignature, signedPreKeyId } = req.body;

        const token = await authManager.register(
            username,
            password,
            identityKey,
            signedPreKey,
            signedPreKeySignature,
            signedPreKeyId
        );

        res.json({ token, username });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ error: error.message });
    }
});

app.post('/auth/login', rateLimit(60000, 10), async (req, res) => {
    try {
        const { username, password } = req.body;
        const token = await authManager.login(username, password);
        res.json({ token, username });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ error: error.message });
    }
});

app.get('/api/prekeys/:username', authenticateHTTP, async (req, res) => {
    try {
        const { username } = req.params;
        console.log(`📦 Fetching pre-key bundle for: ${username}`);
        const bundle = await database.getPreKeyBundle(username);

        if (!bundle) {
            console.log(`❌ User not found: ${username}`);
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`✅ Returning bundle for ${username}:`, {
            identityKey: bundle.identityKey.substring(0, 20) + '...',
            signedPreKeyId: bundle.signedPreKeyId
        });
        res.json(bundle);
    } catch (error) {
        console.error('Get pre-keys error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

// Socket.IO with authentication
io.use(authenticateSocket);

io.on('connection', async (socket) => {
    console.log('User connected:', socket.username);

    socket.on('register', async (username) => {
        if (username !== socket.username) {
            socket.emit('error', { message: 'Username mismatch' });
            return;
        }

        messageQueue.registerUser(username, socket.id);
        await database.updateLastSeen(username);

        io.emit('users', messageQueue.getOnlineUsers());

        await messageQueue.deliverUndeliveredMessages(username, socket.id);
    });

    socket.on('key-exchange', ({ to, bundle, ephemeralPublicKey }) => {
        const recipientSocketId = messageQueue.users.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('key-exchange', {
                from: socket.username,
                bundle,
                ephemeralPublicKey
            });
            console.log(`Key exchange from ${socket.username} to ${to}`);
        }
    });

    socket.on('key-exchange-response', ({ to, bundle }) => {
        const recipientSocketId = messageQueue.users.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('key-exchange-response', {
                from: socket.username,
                bundle
            });
            console.log(`Key exchange response from ${socket.username} to ${to}`);
        }
    });

    socket.on('message', async ({ messageId, to, encryptedMessage }, callback) => {
        try {
            if (!messageId || !to || !encryptedMessage) {
                callback({ success: false, error: 'Invalid message' });
                return;
            }

            await messageQueue.queueMessage(messageId, socket.username, to, encryptedMessage);

            callback({ success: true, messageId });
            console.log(`Message from ${socket.username} to ${to}`);
        } catch (error) {
            console.error('Message error:', error);
            callback({ success: false, error: 'Failed to send message' });
        }
    });

    socket.on('message_ack', async ({ messageId }) => {
        socket.emit(`ack_${messageId}`);
    });

    socket.on('disconnect', () => {
        messageQueue.unregisterUser(socket.username);
        io.emit('users', messageQueue.getOnlineUsers());
        console.log(`User disconnected: ${socket.username}`);
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    httpServer.close(() => {
        database.pool.end();
        process.exit(0);
    });
});