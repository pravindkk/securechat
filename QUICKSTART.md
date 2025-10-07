# SecureChat - Quick Start Guide

Get up and running in 5 minutes!

## 1️⃣ Install PostgreSQL

```bash
brew install postgresql@15
brew services start postgresql@15
```

## 2️⃣ Create Database

```bash
psql postgres
```

In PostgreSQL prompt:
```sql
CREATE DATABASE securechat;
CREATE USER securechat_user WITH ENCRYPTED PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE securechat TO securechat_user;
\q
```

## 3️⃣ Setup Server

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env` and update `DB_PASSWORD` to match your password above.

```bash
npm start
```

## 4️⃣ Setup Client

Open a new terminal:
```bash
npm install
npm start
```

Press `i` for iOS or `a` for Android.

## 5️⃣ Test It Out

1. **Register two users** (e.g., "alice" and "bob")
2. **Login with both users** on separate simulators/devices
3. **Start chatting** - key exchange happens automatically!

---

## 🆘 Having Issues?

See the full [SETUP.md](SETUP.md) guide for detailed troubleshooting.

### Quick Fixes

**PostgreSQL not connecting?**
```bash
brew services restart postgresql@15
```

**Port 3000 in use?**
```bash
lsof -ti:3000 | xargs kill -9
```

**Key mismatch errors?**
- Use "Clear All Data (Dev)" button in app
- Re-register both users

**Need two simulators?**
- Open Xcode → Window → Devices and Simulators
- Click "+" to create another simulator
