// server/auth.js
const jwt = require('jsonwebtoken');
const database = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '7d';

class AuthManager {
    generateToken(username) {
        return jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    }

    verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    async register(username, password, identityKey, signedPreKey, signedPreKeySignature, signedPreKeyId) {
        if (!username || !password || !identityKey || !signedPreKey || !signedPreKeySignature) {
            throw new Error('Missing required fields');
        }

        if (username.length < 3 || username.length > 30) {
            throw new Error('Username must be 3-30 characters');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        await database.createUser(
            username,
            password,
            identityKey,
            signedPreKey,
            signedPreKeySignature,
            signedPreKeyId
        );

        return this.generateToken(username);
    }

    async login(username, password) {
        const user = await database.authenticateUser(username, password);

        if (!user) {
            throw new Error('Invalid credentials');
        }

        await database.updateLastSeen(username);

        return this.generateToken(username);
    }
}

module.exports = new AuthManager();