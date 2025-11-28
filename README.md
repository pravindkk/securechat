# Secure Chat - TLS 1.3 Style Encrypted Messaging

A secure, end-to-end encrypted messaging application with **multi-device support** and **OTP-only authentication**.

## Features

- 🔐 **TLS 1.3 Style Encryption**: RSA-OAEP key exchange + AES-256-GCM message encryption
- 📱 **Multi-Device Support**: Login from any device with the same account
- 🔑 **OTP-Only Authentication**: No passwords, just email verification codes
- 🔄 **Real-time Messaging**: Socket.IO powered instant messaging
- 📷 **Image Sharing**: Upload and share images with encrypted captions
- 🐳 **Fully Dockerized**: Easy deployment with Docker Compose
- 💾 **Robust Storage**: PostgreSQL + MongoDB + Redis
- 🤖 **Bot-Ready Architecture**: Designed for future Telegram-style bot framework

## Quick Start - Development Setup

### Prerequisites

- **Docker & Docker Compose** (for databases)
- **Node.js 18+** (for running frontend/backend)
- **npm** or **yarn**

### Step 1: Clone and Setup

```bash
# Clone the repository
git clone <repo-url>
cd secure-chat-tls
```

### Step 2: Start Infrastructure (Databases)

```bash
# Start PostgreSQL, MongoDB, Redis, and MinIO
docker-compose -f docker-compose.infra.yml up -d

# Verify all containers are running
docker-compose -f docker-compose.infra.yml ps
```

You should see:
- `postgres` - PostgreSQL database (port 5432)
- `mongo` - MongoDB database (port 27017)
- `redis` - Redis cache (port 6379)
- `minio` - File storage (port 9000, console at 9001)

### Step 3: Setup Backend

```bash
# Navigate to backend
cd backend

# Copy environment file
cp .env.example .env

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Start the backend server
npm run dev
```

The backend will start at **http://localhost:5001**

You should see:
```
🚀 Server running on port 5001
📦 PostgreSQL connected
📦 MongoDB connected
📦 Redis connected
```

### Step 4: Setup Frontend

Open a new terminal:

```bash
# Navigate to frontend
cd frontend

# Copy environment file
cp .env.example .env

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend will start at **http://localhost:3000**

### Step 5: Test the Application

1. Open **http://localhost:3000** in your browser
2. Enter any email address (e.g., `test@example.com`)
3. Check the **backend terminal** for the OTP code (it will be logged like: `🔐 OTP for test@example.com: 123456`)
4. Enter the OTP code
5. For new users, enter a display name
6. You're logged in!

To test messaging:
1. Open another browser/incognito window
2. Register a second user with a different email
3. Search for the first user and start a chat
4. Send encrypted messages!

## Project Structure

```
secure-chat-tls/
├── backend/                  # Node.js/Express backend
│   ├── src/
│   │   ├── config/          # Database connections, config
│   │   ├── middleware/      # Auth, error handling
│   │   ├── models/          # MongoDB models
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── socket/          # Socket.IO handlers
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Helpers, crypto functions
│   ├── prisma/              # PostgreSQL schema
│   └── .env.example         # Environment template
│
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── contexts/        # React context providers
│   │   ├── crypto/          # Client-side encryption
│   │   ├── services/        # API client, socket client
│   │   └── types/           # TypeScript types
│   └── .env.example         # Environment template
│
├── docker-compose.yml       # Full deployment (all services)
└── docker-compose.infra.yml # Infrastructure only (databases)
```

## Security Architecture

### Encryption Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER REGISTRATION                         │
├─────────────────────────────────────────────────────────────────┤
│ 1. User enters email                                            │
│ 2. Server generates OTP, sends to email                         │
│ 3. User verifies OTP                                            │
│ 4. Server generates RSA-2048 keypair for user                   │
│ 5. Private key encrypted with PBKDF2(OTP + email)               │
│ 6. Public key stored plaintext, encrypted private key stored    │
│ 7. User receives JWT tokens + encrypted private key             │
│ 8. Client decrypts private key with OTP, stores in session      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        ROOM CREATION                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. Server generates AES-256 room key                            │
│ 2. Room key wrapped with each member's RSA public key           │
│ 3. Each member stores their wrapped room key                    │
│ 4. Members decrypt room key with their private key              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        MESSAGE ENCRYPTION                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. Sender retrieves room key (decrypts with private key)        │
│ 2. Message encrypted with AES-256-GCM using room key            │
│ 3. Encrypted message + IV + AuthTag sent to server              │
│ 4. Recipient decrypts using same room key                       │
└─────────────────────────────────────────────────────────────────┘
```

### Multi-Device Support

Unlike Signal/WhatsApp's Double Ratchet (device-specific keys), this system uses:
- **User-level keys**: Same RSA keypair works on all devices
- **Session-based decryption**: Private key decrypted from OTP during login
- **Session storage**: Decrypted private key stored in browser session

This enables:
- Login from any new device with just email + OTP
- No device linking/pairing required
- Future bot integration (bots have API keys = stable keypairs)

## Tech Stack

### Frontend
- React 18 with TypeScript
- Material-UI
- Socket.IO Client
- Web Crypto API
- Vite

### Backend
- Node.js with TypeScript
- Express.js
- Socket.IO Server
- Prisma ORM (PostgreSQL)
- Mongoose (MongoDB)
- JWT Authentication

### Infrastructure
- PostgreSQL 15 (users, rooms, keys)
- MongoDB 7 (messages)
- Redis 7 (sessions, pub/sub)
- MinIO (file storage)
- Nginx (reverse proxy)

## Full Docker Deployment

For production or testing the complete stack:

```bash
# Start all services including frontend and backend
docker-compose up -d

# Access:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:5001
# - MinIO Console: http://localhost:9001
```

## Environment Variables

### Backend (.env)

```env
NODE_ENV=development
PORT=5001

# Database
DATABASE_URL=postgresql://chatapp:chatapp@localhost:5432/chatapp?schema=public
MONGODB_URI=mongodb://localhost:27017/chatapp
REDIS_URL=redis://localhost:6379

# Auth (generate secure values for production!)
JWT_SECRET=your_32_char_secret_here
JWT_REFRESH_SECRET=your_other_32_char_secret

# CORS
CORS_ORIGIN=http://localhost:3000

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=chatapp
MINIO_USE_SSL=false

# Encryption (hex-encoded 32 bytes)
MASTER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:5001
VITE_SOCKET_URL=http://localhost:5001
```

## Common Issues

### "Prisma Client not generated"
```bash
cd backend
npx prisma generate
```

### "Database connection failed"
```bash
# Make sure infrastructure is running
docker-compose -f docker-compose.infra.yml ps

# If not running, start it
docker-compose -f docker-compose.infra.yml up -d
```

### "CORS error"
Make sure `CORS_ORIGIN` in backend `.env` matches your frontend URL (e.g., `http://localhost:3000`)

### "No encryption keys found"
This happens when you refresh after closing the browser tab. Just log in again with your email and OTP.

## API Documentation

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/request-otp` | POST | Request OTP for login/registration |
| `/api/auth/verify-otp` | POST | Verify OTP and authenticate |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/logout` | POST | Logout user |
| `/api/auth/me` | GET | Get current user |
| `/api/auth/keys` | GET | Get encrypted private key |

### Rooms

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms` | POST | Create room |
| `/api/rooms/chats` | GET | Get user's chats |
| `/api/rooms/:id` | GET | Get room details |
| `/api/rooms/:id/key` | GET | Get encrypted room key |
| `/api/rooms/:id/read` | POST | Mark as read |

### Messages

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/messages/:roomId` | GET | Get messages (paginated) |
| `/api/messages/:roomId` | POST | Send encrypted message |
| `/api/messages/:id` | DELETE | Delete message |

### Users

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users` | GET | Search users |
| `/api/users/:id` | GET | Get user |
| `/api/users/:id/public-key` | GET | Get user's public key |
| `/api/users/me/devices` | GET | List user's devices |

## Socket.IO Events

### Client → Server
- `join_room` - Join a chat room
- `leave_room` - Leave a chat room
- `typing` - Start typing indicator
- `stop_typing` - Stop typing indicator
- `mark_read` - Mark messages as read
- `update_presence` - Update online status

### Server → Client
- `new_message` - New message received
- `user_typing` - User started typing
- `user_stop_typing` - User stopped typing
- `presence_update` - User online status changed
- `unread_count_update` - Unread count changed

## Security Considerations

### What's Secure
- ✅ End-to-end encrypted messages (AES-256-GCM)
- ✅ Private keys encrypted at rest (PBKDF2 + AES-256-GCM)
- ✅ Room keys wrapped with RSA-OAEP
- ✅ No passwords stored (OTP-only)
- ✅ JWTs for session management

### What to Know
- ⚠️ Server generates keypairs (trust server for key generation)
- ⚠️ Session storage holds decrypted private key (cleared on tab close)
- ⚠️ OTP used for key derivation (OTP must be kept secret during login)
- ⚠️ Image URLs are public (only captions are encrypted)

### Production Checklist
- [ ] Generate strong, unique JWT secrets
- [ ] Generate unique MASTER_ENCRYPTION_KEY
- [ ] Enable HTTPS everywhere
- [ ] Configure proper CORS origins
- [ ] Set up database backups
- [ ] Enable rate limiting
- [ ] Set up monitoring/logging
- [ ] Configure email delivery for OTPs

## Future Bot Framework

The architecture supports future Telegram-style bots:

```
┌─────────────────────────────────────────────────────────────────┐
│                        BOT ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────┤
│ 1. Bot created with permanent API key                           │
│ 2. Bot has RSA keypair (like users)                             │
│ 3. Bot receives webhooks for new messages                       │
│ 4. Bot decrypts messages using its private key                  │
│ 5. Bot responds via API with encrypted messages                 │
└─────────────────────────────────────────────────────────────────┘
```

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions welcome! Please read our contributing guidelines first.
