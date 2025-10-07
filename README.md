# SecureChat 🔐

**Production-ready end-to-end encrypted chat application using Signal Protocol**

Built with React Native, Node.js, and PostgreSQL. Implements X3DH key agreement and Double Ratchet encryption for military-grade security.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## ✨ Features

### Security
- 🔐 **Signal Protocol Implementation** - X3DH + Double Ratchet
- 🔑 **Perfect Forward Secrecy** - Past messages stay secure
- 🛡️ **Post-Compromise Security** - Self-healing encryption
- 🔒 **End-to-End Encryption** - Server never sees plaintext
- ✍️ **Digital Signatures** - Ed25519 signature verification
- 🔐 **Authenticated Encryption** - XChaCha20-Poly1305 AEAD

### Functionality
- 💬 Real-time encrypted messaging
- 👥 Multi-user support
- 📱 Offline message queue
- ✅ Message status indicators (sending, sent, delivered)
- ⚡ Optimistic UI updates
- 🔄 Automatic key exchange
- 💾 Secure key storage (device keychain)

---

## 🚀 Quick Start

**New to the project?** Choose your speed:

- **Fast Track** → [QUICKSTART.md](QUICKSTART.md) - 5 minute setup
- **Detailed Guide** → [SETUP.md](SETUP.md) - Full setup with explanations

### TL;DR

```bash
# 1. Install & start PostgreSQL
brew install postgresql@15
brew services start postgresql@15

# 2. Create database
psql postgres -c "CREATE DATABASE securechat;"
psql postgres -c "CREATE USER securechat_user WITH ENCRYPTED PASSWORD 'yourpassword';"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE securechat TO securechat_user;"

# 3. Setup server
cd server && npm install && cp .env.example .env
# Edit .env with your database password
npm start

# 4. Setup client (new terminal)
npm install && npm start
# Press 'i' for iOS or 'a' for Android
```

**Testing:** Register two users (e.g., "alice" and "bob") and start chatting!

---

## 🔐 How It Works

### Encryption Protocol

SecureChat implements the **Signal Protocol** (used by WhatsApp, Signal, and Facebook Messenger):

#### 1. Initial Key Exchange (X3DH)
When Alice wants to message Bob:
- Alice fetches Bob's **identity key** and **signed pre-key** from the server
- Alice generates an **ephemeral key** pair
- Performs **4 Diffie-Hellman** operations: DH(IKa, SPKb), DH(EKa, IKb), DH(EKa, SPKb), DH(EKa, OPKb)
- Derives a **shared secret** using HKDF-SHA256
- Both parties now have the same shared secret without ever transmitting it

#### 2. Message Encryption (Double Ratchet)
For each message:
- **Root Key Ratchet**: Updates root key via DH ratchet (forward secrecy)
- **Chain Key Ratchet**: Derives unique message keys via HMAC-SHA256
- **Encryption**: XChaCha20-Poly1305 AEAD with the message key
- **Out-of-order**: Handles out-of-order messages and skipped message keys

```
Alice                                           Bob
  |                                              |
  |-- X3DH Key Exchange ----------------------->|
  |<------- Encrypted Message 1 ----------------|
  |--------- Encrypted Message 2 -------------->|
  |<------- Encrypted Message 3 ----------------|
  (Each message uses a new encryption key)
```

### Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│   React Native  │◄───────►│   Node.js    │◄───────►│   PostgreSQL    │
│     Client      │  Socket │    Server    │         │    Database     │
│  (Encryption)   │   .IO   │  (Relay)     │         │  (Pre-keys)     │
└─────────────────┘         └──────────────┘         └─────────────────┘
        │                           │
        │                           │
   Expo Secure               Message Queue
     Store                   & Delivery
  (Key Storage)
```

**Client (React Native + Expo)**
- Encryption/decryption (all cryptography is client-side)
- Key generation and storage
- Double Ratchet state management
- UI and messaging logic

**Server (Node.js + Express + Socket.IO)**
- Message relay (never sees plaintext)
- Pre-key bundle storage
- User authentication (JWT)
- Offline message queue
- WebSocket connections

**Database (PostgreSQL)**
- User accounts (hashed passwords with bcrypt)
- Pre-key bundles (public keys only)
- Encrypted messages (temporary storage for offline delivery)

### Security Guarantees

✅ **End-to-End Encryption**: Only sender and recipient can read messages
✅ **Forward Secrecy**: Compromising current keys doesn't expose past messages
✅ **Post-Compromise Security**: After key compromise, system self-heals
✅ **Authentication**: Ed25519 signatures prevent impersonation
✅ **Replay Protection**: Nonces prevent message replay attacks
✅ **Deniability**: Messages can't be cryptographically proven to come from you

---

## 📁 Project Structure

```
securechat/
├── app/                       # React Native client
│   ├── index.tsx              # Main chat UI
│   └── services/
│       ├── CryptoService.ts   # Encryption orchestration
│       ├── SecureStorage.ts   # Keychain access
│       └── SocketService.ts   # WebSocket client
├── crypto/                    # Protocol implementation
│   ├── doubleRatchet.ts       # Double Ratchet algorithm
│   ├── x3dh.ts                # X3DH key agreement
│   └── types.ts               # TypeScript interfaces
├── server/                    # Node.js backend
│   ├── index.js               # Main server
│   ├── auth.js                # JWT authentication
│   ├── database.js            # PostgreSQL queries
│   ├── messageQueue.js        # Message delivery
│   └── middleware.js          # Auth & rate limiting
├── SETUP.md                   # Detailed setup guide
├── QUICKSTART.md              # 5-minute setup
└── README.md                  # This file
```

---

## 🔧 Tech Stack

### Client
- **React Native** - Cross-platform mobile framework
- **Expo** - Development toolchain
- **TypeScript** - Type safety
- **@stablelib** - Cryptographic primitives
  - `x25519` - ECDH key exchange
  - `ed25519` - Digital signatures
  - `xchacha20poly1305` - AEAD encryption
  - `hkdf` - Key derivation
  - `sha256` - Hashing
- **AsyncStorage** - Message persistence
- **Expo SecureStore** - Keychain access
- **Socket.IO Client** - Real-time communication

### Server
- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **Socket.IO** - WebSocket server
- **PostgreSQL** - Database
- **bcrypt** - Password hashing
- **jsonwebtoken** - JWT authentication
- **helmet** - Security headers
- **cors** - CORS handling

---

## 🛡️ Security Considerations

### ✅ What's Implemented
- Signal Protocol (X3DH + Double Ratchet)
- Client-side encryption/decryption only
- Secure key storage (device keychain)
- Password hashing (bcrypt, 12 rounds)
- JWT session management
- Rate limiting on authentication endpoints
- Signature verification on pre-keys
- Out-of-order message handling
- Offline message queue

### ⚠️ Production Recommendations
- [ ] **Certificate Pinning** - Prevent MITM attacks
- [ ] **Key Rotation** - Rotate signed pre-keys periodically
- [ ] **Backup Keys** - Implement encrypted backups
- [ ] **Multi-Device** - Sesame algorithm for multi-device sync
- [ ] **Group Chats** - Sender Keys protocol
- [ ] **Sealed Sender** - Hide message metadata
- [ ] **Safety Numbers** - User key verification
- [ ] **Screen Security** - Prevent screenshots
- [ ] **Secure Deletion** - Wipe keys from memory
- [ ] **Audit Logs** - Security event logging

---

## 📚 Resources

- [Signal Protocol Specifications](https://signal.org/docs/)
- [The Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [The X3DH Key Agreement Protocol](https://signal.org/docs/specifications/x3dh/)
- [XChaCha20-Poly1305 AEAD](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha)
- [Elliptic Curve Cryptography (Ed25519/X25519)](https://cr.yp.to/ecdh.html)

