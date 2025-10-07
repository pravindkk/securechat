# SecureChat - Development Setup Guide

A production-ready end-to-end encrypted chat application using Signal Protocol (X3DH + Double Ratchet).

---

## 📋 Prerequisites

- macOS with Homebrew installed
- Node.js (v16 or higher)
- npm or yarn
- Xcode Command Line Tools
- iOS Simulator (for testing) or Android Studio

---

## 🔧 Setup Instructions

### 1. Install PostgreSQL

```bash
# Install PostgreSQL via Homebrew
brew install postgresql@15

# Start PostgreSQL service
brew services start postgresql@15

# Verify installation
psql --version
```

### 2. Create Database and User

```bash
# Connect to PostgreSQL as the default user
psql postgres

# In the PostgreSQL prompt, run these commands:
CREATE DATABASE securechat;
CREATE USER securechat_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE securechat TO securechat_user;

# Exit PostgreSQL
\q
```

**Note:** The database tables will be created automatically when you start the server for the first time.

### 3. Server Setup

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

**Edit `server/.env` file:**
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=securechat
DB_USER=securechat_user
DB_PASSWORD=your_secure_password

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production

# Server Configuration
PORT=3000
NODE_ENV=development
```

**Start the server:**
```bash
npm start

# Or for development with auto-reload:
npm run dev
```

You should see:
```
Database initialized
Server running on port 3000
Environment: development
```

### 4. Client Setup

Open a **new terminal window** and navigate to the project root:

```bash
# Install dependencies
npm install

# Install iOS dependencies (if on macOS)
npx pod-install

# Start the Expo development server
npm start
```

### 5. Run the Application

After `npm start`, you'll see options:

```bash
# For iOS Simulator
Press 'i'

# For Android Emulator
Press 'a'

# For web (limited functionality)
Press 'w'
```

---

## 🧪 Testing the Application

### First-Time Setup

1. **Start the server** (in one terminal):
   ```bash
   cd server
   npm start
   ```

2. **Start the client** (in another terminal):
   ```bash
   npm start
   # Press 'i' for iOS or 'a' for Android
   ```

3. **Register two users:**
   - Open the app on first simulator/device → Register as "alice"
   - Open the app on second simulator/device → Register as "bob"

4. **Start chatting:**
   - Alice selects Bob from the user list
   - Key exchange happens automatically
   - Send encrypted messages!

---

## 📁 Project Structure

```
securechat/
├── app/                          # React Native client
│   ├── index.tsx                 # Main chat UI
│   ├── _layout.tsx               # App layout
│   └── services/                 # Client services
│       ├── CryptoService.ts      # Encryption logic
│       ├── SecureStorage.ts      # Key storage
│       └── SocketService.ts      # WebSocket communication
├── crypto/                       # Cryptography implementation
│   ├── doubleRatchet.ts          # Double Ratchet algorithm
│   ├── x3dh.ts                   # X3DH key agreement
│   └── types.ts                  # TypeScript types
├── server/                       # Node.js backend
│   ├── index.js                  # Main server file
│   ├── auth.js                   # Authentication
│   ├── database.js               # PostgreSQL operations
│   ├── messageQueue.js           # Message delivery
│   └── middleware.js             # Auth & rate limiting
└── package.json
```

---

## 🗄️ Database Schema

The following tables are created automatically:

### `users`
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  identity_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP
);
```

### `pre_keys`
```sql
CREATE TABLE pre_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key_id BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, key_id)
);
```

### `messages`
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  from_username VARCHAR(255) NOT NULL,
  to_username VARCHAR(255) NOT NULL,
  encrypted_content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  delivered BOOLEAN DEFAULT FALSE,
  delivered_at TIMESTAMP
);
```

---

## 🔐 Security Features

- **X3DH Key Agreement**: Initial key exchange using Extended Triple Diffie-Hellman
- **Double Ratchet**: Forward secrecy and self-healing properties
- **XChaCha20-Poly1305**: Authenticated encryption
- **Ed25519**: Digital signatures
- **X25519**: Elliptic curve Diffie-Hellman
- **HKDF-SHA256**: Key derivation
- **bcrypt**: Password hashing (12 rounds)
- **JWT**: Session management

---

## 🛠️ Common Issues & Solutions

### Issue: PostgreSQL connection fails

**Solution:**
```bash
# Check if PostgreSQL is running
brew services list

# Restart PostgreSQL
brew services restart postgresql@15

# Check connection
psql -U securechat_user -d securechat
```

### Issue: "Local keys do not match server"

**Solution:**
```bash
# Clear app data using the "Clear All Data (Dev)" button in the app
# Then re-register both users
```

### Issue: Database tables not created

**Solution:**
```bash
# Connect to database
psql -U securechat_user -d securechat

# Check if tables exist
\dt

# If not, restart the server - tables are auto-created on startup
```

### Issue: Port 3000 already in use

**Solution:**
```bash
# Find and kill the process using port 3000
lsof -ti:3000 | xargs kill -9

# Or change the port in server/.env
PORT=3001
```

### Issue: Expo/React Native errors

**Solution:**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Expo cache
npx expo start -c
```

---

## 📱 Running on Multiple Devices/Simulators

### Method 1: Two iOS Simulators
```bash
# Start first simulator
npx expo start
# Press 'i'

# In Xcode, open a second simulator (Window → Devices and Simulators)
# The app will automatically install on both
```

### Method 2: iOS Simulator + Physical Device
```bash
# Start Expo
npx expo start

# Scan QR code with Expo Go app on your phone
# Press 'i' for simulator
```

### Method 3: Two Physical Devices
```bash
# Make sure both devices are on the same WiFi network
npm start

# Scan QR code on both devices using Expo Go
```

**Important:** Update the server URL in `app/index.tsx` if testing on physical devices:
```typescript
// Change from:
const SERVER_URL = 'http://localhost:3000';

// To your computer's local IP:
const SERVER_URL = 'http://192.168.1.XXX:3000';
```

---

## 🔄 Resetting the Application

### Reset Database
```bash
# Connect to PostgreSQL
psql -U securechat_user -d securechat

# Delete all data
DELETE FROM messages;
DELETE FROM pre_keys;
DELETE FROM users;

# Or drop and recreate the database
DROP DATABASE securechat;
CREATE DATABASE securechat;
```

### Reset Client Keys
- Use the "Clear All Data (Dev)" button in the app
- Or reinstall the app

---

## 📚 API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user

### Pre-Keys
- `GET /api/prekeys/:username` - Get user's pre-key bundle

### Health
- `GET /health` - Server health check

### WebSocket Events
- `register` - Register user with socket
- `key-exchange` - Initiate key exchange
- `key-exchange-response` - Respond to key exchange
- `message` - Send encrypted message
- `message_ack` - Acknowledge message receipt

---

## 🚀 Production Deployment

### Environment Variables

**Server (.env):**
```env
DB_HOST=your_production_db_host
DB_PORT=5432
DB_NAME=securechat_prod
DB_USER=securechat_prod_user
DB_PASSWORD=strong_random_password
JWT_SECRET=strong_random_jwt_secret_min_32_chars
PORT=3000
NODE_ENV=production
```

**Client:**
Update `SERVER_URL` in `app/index.tsx`:
```typescript
const SERVER_URL = 'https://your-production-api.com';
```

### Security Checklist
- [ ] Change all default passwords
- [ ] Use strong JWT secret (32+ characters)
- [ ] Enable SSL/TLS for database connections
- [ ] Use HTTPS for API endpoints
- [ ] Enable rate limiting (already implemented)
- [ ] Set up proper CORS policies
- [ ] Regular security audits
- [ ] Key rotation policies
- [ ] Backup strategies

---

## 📖 Further Reading

- [Signal Protocol Specifications](https://signal.org/docs/)
- [Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [X3DH Key Agreement](https://signal.org/docs/specifications/x3dh/)
- [React Native Documentation](https://reactnative.dev/)
- [Expo Documentation](https://docs.expo.dev/)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📄 License

[Add your license here]

---

## 💡 Tips

- **Clear data before re-registering**: Always use "Clear All Data" if you encounter key mismatches
- **Test on real devices**: Encryption performance differs between simulators and real devices
- **Monitor logs**: Check both server and client logs for debugging
- **Database backups**: Regular backups in production are essential
- **Key rotation**: Implement signed pre-key rotation for long-term security

---

**Questions or Issues?** Check the troubleshooting section or open an issue on GitHub.
