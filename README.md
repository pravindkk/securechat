# SecureChat - End-to-End Encrypted Chat App

A simple Expo-based chat application with client-side end-to-end encryption using the Double Ratchet algorithm.

## Features

- End-to-end encryption using Double Ratchet algorithm
- Real-time messaging with Socket.IO
- Simple and intuitive UI
- Message persistence with AsyncStorage

## Setup

### 1. Install Dependencies

```bash
# Install client dependencies
npm install

# Install server dependencies
cd server
npm install
cd ..
```

### 2. Run the Server

```bash
npm run server
```

The server will run on `http://localhost:3000`

### 3. Run the Expo App

In a separate terminal:

```bash
npm start
```

Then press:
- `i` for iOS simulator
- `a` for Android emulator
- Scan QR code with Expo Go app on your phone

### 4. Update Server URL

If testing on a physical device, update the `SERVER_URL` in `app/index.tsx` to your computer's local IP address:

```typescript
const SERVER_URL = 'http://YOUR_LOCAL_IP:3000';
```

## How It Works

### Double Ratchet Encryption

The app implements the Double Ratchet algorithm based on Signal's protocol:

1. **Key Exchange**: When two users start chatting, they perform an initial key exchange
2. **Symmetric Ratchet**: Each message uses a unique encryption key derived from a chain
3. **DH Ratchet**: Periodically updates keys using Diffie-Hellman exchanges for forward secrecy

### Architecture

- **Client**: React Native (Expo) with TypeScript
- **Server**: Node.js with Express and Socket.IO (simple relay server)
- **Encryption**: All encryption/decryption happens on the client side
- **Storage**: AsyncStorage for persisting ratchet states and messages

## Security Features

- Client-side encryption/decryption only
- Server never sees plaintext messages
- Forward secrecy (past messages can't be decrypted if keys are compromised)
- Break-in recovery (future messages are secure even if current key is compromised)

## Note

This is a demonstration app. For production use, consider:
- Proper key management and storage
- Certificate pinning
- Additional authentication mechanisms
- Proper error handling and edge cases
- Message delivery confirmations
- Offline message queuing
