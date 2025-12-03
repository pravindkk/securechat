/**
 * IndexedDB Service with WebCrypto API for Secure Key Storage
 *
 * This service provides:
 * - Encrypted storage of private keys in IndexedDB
 * - WebCrypto-based encryption at rest
 * - Automatic key derivation from device-specific data
 * - Secure key retrieval and caching
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

// Database schema
interface SecureChatDB extends DBSchema {
  keys: {
    key: string;
    value: {
      id: string;
      userId: string;
      encryptedData: ArrayBuffer;
      iv: Uint8Array;
      salt: Uint8Array;
      createdAt: number;
      lastAccessed: number;
    };
    indexes: { 'by-userId': string };
  };
  roomKeys: {
    key: string;
    value: {
      id: string;
      encryptedKey: string;
      version: number;
      cachedAt: number;
    };
  };
  tokens: {
    key: string;
    value: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
  };
  deviceInfo: {
    key: string;
    value: {
      fingerprint: string;
      derivedKeyHash: ArrayBuffer;
      createdAt: number;
    };
  };
}

const DB_NAME = 'securechat-db';
const DB_VERSION = 1;

// Key derivation parameters
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256;

class IndexedDBService {
  private db: IDBPDatabase<SecureChatDB> | null = null;
  private deviceKey: CryptoKey | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initializeDB();
    return this.initPromise;
  }

  private async initializeDB(): Promise<void> {
    if (typeof window === 'undefined') {
      return; // SSR - no IndexedDB
    }

    this.db = await openDB<SecureChatDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Keys store for encrypted private keys
        if (!db.objectStoreNames.contains('keys')) {
          const keysStore = db.createObjectStore('keys', { keyPath: 'id' });
          keysStore.createIndex('by-userId', 'userId');
        }

        // Room keys cache
        if (!db.objectStoreNames.contains('roomKeys')) {
          db.createObjectStore('roomKeys', { keyPath: 'id' });
        }

        // Tokens store
        if (!db.objectStoreNames.contains('tokens')) {
          db.createObjectStore('tokens', { keyPath: 'accessToken' });
        }

        // Device info store
        if (!db.objectStoreNames.contains('deviceInfo')) {
          db.createObjectStore('deviceInfo', { keyPath: 'fingerprint' });
        }
      },
    });

    // Initialize device key for encrypting data at rest
    await this.initDeviceKey();
  }

  /**
   * Generate a device-specific encryption key using WebCrypto
   * This key is derived from device fingerprint + random salt
   */
  private async initDeviceKey(): Promise<void> {
    if (!this.db) return;

    const fingerprint = this.getDeviceFingerprint();

    // Check if we have existing device info
    const existing = await this.db.get('deviceInfo', fingerprint);

    let salt: Uint8Array;

    if (existing) {
      // Use existing salt
      salt = new Uint8Array(32);
      const storedSalt = existing.derivedKeyHash;
      new Uint8Array(storedSalt).forEach((b, i) => {
        if (i < 32) salt[i] = b;
      });
    } else {
      // Generate new salt
      salt = crypto.getRandomValues(new Uint8Array(32));

      // Store device info
      await this.db.put('deviceInfo', {
        fingerprint,
        derivedKeyHash: salt.buffer as ArrayBuffer,
        createdAt: Date.now(),
      });
    }

    // Derive key from fingerprint + salt
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(fingerprint),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    this.deviceKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generate device fingerprint for key derivation
   */
  private getDeviceFingerprint(): string {
    if (typeof window === 'undefined') return 'server';

    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset().toString(),
      navigator.hardwareConcurrency?.toString() || 'unknown',
    ];

    // Simple hash
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16);
  }

  /**
   * Store encrypted private key in IndexedDB
   */
  async storePrivateKey(userId: string, privateKeyPem: string): Promise<void> {
    if (!this.db || !this.deviceKey) {
      throw new Error('IndexedDB not initialized');
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Encrypt the private key
    const encodedKey = new TextEncoder().encode(privateKeyPem);
    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.deviceKey,
      encodedKey
    );

    await this.db.put('keys', {
      id: `key-${userId}`,
      userId,
      encryptedData,
      iv,
      salt,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    });
  }

  /**
   * Retrieve and decrypt private key from IndexedDB
   */
  async getPrivateKey(userId: string): Promise<string | null> {
    if (!this.db || !this.deviceKey) {
      return null;
    }

    const stored = await this.db.get('keys', `key-${userId}`);
    if (!stored) {
      return null;
    }

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: stored.iv as BufferSource },
        this.deviceKey,
        stored.encryptedData
      );

      // Update last accessed time
      await this.db.put('keys', {
        ...stored,
        lastAccessed: Date.now(),
      });

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Failed to decrypt private key:', error);
      return null;
    }
  }

  /**
   * Remove private key from IndexedDB
   */
  async removePrivateKey(userId: string): Promise<void> {
    if (!this.db) return;
    await this.db.delete('keys', `key-${userId}`);
  }

  /**
   * Check if private key exists for user
   */
  async hasPrivateKey(userId: string): Promise<boolean> {
    if (!this.db) return false;
    const stored = await this.db.get('keys', `key-${userId}`);
    return !!stored;
  }

  /**
   * Store tokens
   */
  async storeTokens(accessToken: string, refreshToken: string): Promise<void> {
    if (!this.db) return;

    // Clear old tokens first
    await this.clearTokens();

    await this.db.put('tokens', {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  /**
   * Get stored tokens
   */
  async getTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (!this.db) return null;

    const all = await this.db.getAll('tokens');
    if (all.length === 0) return null;

    const token = all[0];
    if (token.expiresAt < Date.now()) {
      await this.clearTokens();
      return null;
    }

    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
    };
  }

  /**
   * Clear all tokens
   */
  async clearTokens(): Promise<void> {
    if (!this.db) return;
    await this.db.clear('tokens');
  }

  /**
   * Store room key in cache
   */
  async cacheRoomKey(roomId: string, encryptedKey: string, version: number): Promise<void> {
    if (!this.db) return;

    await this.db.put('roomKeys', {
      id: `${roomId}:${version}`,
      encryptedKey,
      version,
      cachedAt: Date.now(),
    });
  }

  /**
   * Get cached room key
   */
  async getCachedRoomKey(roomId: string, version: number): Promise<string | null> {
    if (!this.db) return null;

    const cached = await this.db.get('roomKeys', `${roomId}:${version}`);
    if (!cached) return null;

    // Cache expires after 24 hours
    if (Date.now() - cached.cachedAt > 24 * 60 * 60 * 1000) {
      await this.db.delete('roomKeys', `${roomId}:${version}`);
      return null;
    }

    return cached.encryptedKey;
  }

  /**
   * Clear room key cache for a specific room
   */
  async clearRoomKeyCache(roomId: string): Promise<void> {
    if (!this.db) return;

    const all = await this.db.getAll('roomKeys');
    for (const key of all) {
      if (key.id.startsWith(`${roomId}:`)) {
        await this.db.delete('roomKeys', key.id);
      }
    }
  }

  /**
   * Clear all room key cache
   */
  async clearAllRoomKeyCache(): Promise<void> {
    if (!this.db) return;
    await this.db.clear('roomKeys');
  }

  /**
   * Clear all data (for logout)
   */
  async clearAll(): Promise<void> {
    if (!this.db) return;
    await Promise.all([
      this.db.clear('keys'),
      this.db.clear('roomKeys'),
      this.db.clear('tokens'),
    ]);
  }

  /**
   * Check if database is ready
   */
  isReady(): boolean {
    return this.db !== null && this.deviceKey !== null;
  }
}

// Singleton instance
export const indexedDBService = new IndexedDBService();
export default indexedDBService;
