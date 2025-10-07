// server/database.js
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

class Database {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME || 'securechat',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }

    async initialize() {
        const client = await this.pool.connect();
        try {
            await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          identity_key TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          last_seen TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pre_keys (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          key_id BIGINT NOT NULL,
          public_key TEXT NOT NULL,
          signature TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, key_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY,
          from_username VARCHAR(255) NOT NULL,
          to_username VARCHAR(255) NOT NULL,
          encrypted_content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          delivered BOOLEAN DEFAULT FALSE,
          delivered_at TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_messages_to_delivered 
        ON messages(to_username, delivered);
        
        CREATE INDEX IF NOT EXISTS idx_messages_created 
        ON messages(created_at);
      `);
            console.log('Database initialized');
        } finally {
            client.release();
        }
    }

    async createUser(username, password, identityKey, signedPreKey, signedPreKeySignature, signedPreKeyId) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const hashedPassword = await bcrypt.hash(password, 12);

            const userResult = await client.query(
                'INSERT INTO users (username, password_hash, identity_key) VALUES ($1, $2, $3) RETURNING id',
                [username, hashedPassword, identityKey]
            );

            const userId = userResult.rows[0].id;

            await client.query(
                'INSERT INTO pre_keys (user_id, key_id, public_key, signature) VALUES ($1, $2, $3, $4)',
                [userId, signedPreKeyId, signedPreKey, signedPreKeySignature]
            );

            await client.query('COMMIT');
            return userId;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async authenticateUser(username, password) {
        const result = await this.pool.query(
            'SELECT id, password_hash FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);

        return valid ? { id: user.id, username } : null;
    }

    async getPreKeyBundle(username) {
        const result = await this.pool.query(`
      SELECT u.identity_key, p.key_id, p.public_key, p.signature
      FROM users u
      JOIN pre_keys p ON u.id = p.user_id
      WHERE u.username = $1
      ORDER BY p.created_at DESC
      LIMIT 1
    `, [username]);

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            identityKey: row.identity_key,
            signedPreKey: row.public_key,
            signedPreKeySignature: row.signature,
            signedPreKeyId: row.key_id
        };
    }

    async storeMessage(messageId, from, to, encryptedContent) {
        await this.pool.query(
            'INSERT INTO messages (id, from_username, to_username, encrypted_content) VALUES ($1, $2, $3, $4)',
            [messageId, from, to, encryptedContent]
        );
    }

    async markMessageDelivered(messageId) {
        await this.pool.query(
            'UPDATE messages SET delivered = true, delivered_at = NOW() WHERE id = $1',
            [messageId]
        );
    }

    async getUndeliveredMessages(username) {
        const result = await this.pool.query(
            'SELECT id, from_username, encrypted_content, created_at FROM messages WHERE to_username = $1 AND delivered = false ORDER BY created_at',
            [username]
        );
        return result.rows;
    }

    async updateLastSeen(username) {
        await this.pool.query(
            'UPDATE users SET last_seen = NOW() WHERE username = $1',
            [username]
        );
    }
}

module.exports = new Database();