/**
 * Key Manager for Secure Chat
 *
 * Manages:
 * - User's RSA private key (stored encrypted, decrypted in memory)
 * - Room keys (cached after decryption, supports versioned keys)
 * - Message encryption/decryption
 */

import {
  importPrivateKey,
  decryptRoomKey,
  decryptRoomKeyToBytes,
  aesEncrypt,
  aesDecrypt,
  decryptPrivateKey,
  generateRoomKey as generateRoomKeyFn,
  exportRoomKey,
  encryptRoomKeyForUser as encryptRoomKeyForUserFn,
} from './encryption';

class KeyManager {
  private privateKey: CryptoKey | null = null;
  // Keys are stored as `roomId` for current key or `roomId:version` for versioned keys
  private roomKeys: Map<string, CryptoKey> = new Map();
  private privateKeyPem: string | null = null;
  // Track current key version for each room
  private roomKeyVersions: Map<string, number> = new Map();

  /**
   * Initialize the key manager with the user's decrypted private key
   */
  async initialize(
    encryptedPrivateKeyJson: string,
    otp: string,
    email: string,
    keyEncryptionSalt: string
  ): Promise<void> {
    // Decrypt the private key using OTP
    this.privateKeyPem = await decryptPrivateKey(
      encryptedPrivateKeyJson,
      otp,
      email,
      keyEncryptionSalt
    );

    // Import the private key
    this.privateKey = await importPrivateKey(this.privateKeyPem);

    console.log('[KeyManager] Initialized with private key');
  }

  /**
   * Re-initialize with stored private key PEM (after OTP session)
   * FIX-10: Clear stale room keys from previous session before reinitializing
   */
  async reinitialize(privateKeyPem: string): Promise<void> {
    // Clear any stale room keys from previous session
    this.roomKeys.clear();
    this.roomKeyVersions.clear();

    this.privateKeyPem = privateKeyPem;
    this.privateKey = await importPrivateKey(privateKeyPem);
    console.log('[KeyManager] Re-initialized with stored private key (room keys cleared)');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.privateKey !== null;
  }

  /**
   * Get the private key PEM for storage
   */
  getPrivateKeyPem(): string | null {
    return this.privateKeyPem;
  }

  /**
   * Clear all keys (on logout)
   */
  clear(): void {
    this.privateKey = null;
    this.privateKeyPem = null;
    this.roomKeys.clear();
    this.roomKeyVersions.clear();
    console.log('[KeyManager] Cleared all keys');
  }

  /**
   * Get or decrypt a room key (current version)
   */
  async getRoomKey(roomId: string, encryptedRoomKey: string): Promise<CryptoKey> {
    // Check cache first
    if (this.roomKeys.has(roomId)) {
      return this.roomKeys.get(roomId)!;
    }

    if (!this.privateKey) {
      throw new Error('KeyManager not initialized');
    }

    // Decrypt the room key
    const roomKey = await decryptRoomKey(encryptedRoomKey, this.privateKey);
    this.roomKeys.set(roomId, roomKey);

    console.log(`[KeyManager] Decrypted and cached room key for ${roomId}`);
    return roomKey;
  }

  /**
   * Get or decrypt a room key for a specific version (for decrypting old messages)
   */
  async getRoomKeyForVersion(
    roomId: string,
    version: number,
    encryptedRoomKey: string
  ): Promise<CryptoKey> {
    const cacheKey = `${roomId}:${version}`;

    // Check cache first
    if (this.roomKeys.has(cacheKey)) {
      return this.roomKeys.get(cacheKey)!;
    }

    if (!this.privateKey) {
      throw new Error('KeyManager not initialized');
    }

    // Decrypt the room key
    const roomKey = await decryptRoomKey(encryptedRoomKey, this.privateKey);
    this.roomKeys.set(cacheKey, roomKey);

    console.log(`[KeyManager] Decrypted and cached room key for ${roomId} version ${version}`);
    return roomKey;
  }

  /**
   * Set the current key version for a room
   */
  setRoomKeyVersion(roomId: string, version: number): void {
    this.roomKeyVersions.set(roomId, version);
  }

  /**
   * Get the current key version for a room
   */
  getRoomKeyVersion(roomId: string): number {
    return this.roomKeyVersions.get(roomId) || 1;
  }

  /**
   * Clear a specific room key (when room key is rotated)
   */
  clearRoomKey(roomId: string): void {
    this.roomKeys.delete(roomId);
  }

  /**
   * Clear all keys for a room (including versioned keys)
   */
  clearAllRoomKeys(roomId: string): void {
    // Delete current key
    this.roomKeys.delete(roomId);
    this.roomKeyVersions.delete(roomId);

    // Delete all versioned keys
    for (const key of this.roomKeys.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.roomKeys.delete(key);
      }
    }
  }

  /**
   * Encrypt a message for a room
   */
  async encryptMessage(
    roomId: string,
    encryptedRoomKey: string,
    plaintext: string
  ): Promise<{ ciphertext: string; iv: string; authTag: string }> {
    const roomKey = await this.getRoomKey(roomId, encryptedRoomKey);
    return aesEncrypt(roomKey, plaintext);
  }

  /**
   * Decrypt a message from a room
   */
  async decryptMessage(
    roomId: string,
    encryptedRoomKey: string,
    ciphertext: string,
    iv: string,
    authTag: string
  ): Promise<string> {
    const roomKey = await this.getRoomKey(roomId, encryptedRoomKey);
    return aesDecrypt(roomKey, ciphertext, iv, authTag);
  }

  /**
   * Decrypt a message using a specific key version
   */
  async decryptMessageWithVersion(
    roomId: string,
    version: number,
    encryptedRoomKey: string,
    ciphertext: string,
    iv: string,
    authTag: string
  ): Promise<string> {
    const roomKey = await this.getRoomKeyForVersion(roomId, version, encryptedRoomKey);
    return aesDecrypt(roomKey, ciphertext, iv, authTag);
  }

  /**
   * Get the user's private key (for encrypting room keys for others)
   */
  getPrivateKey(): CryptoKey | null {
    return this.privateKey;
  }

  /**
   * Generate a new room key (for key rotation)
   */
  async generateNewRoomKey(): Promise<CryptoKey> {
    return generateRoomKeyFn();
  }

  /**
   * Decrypt room key and return raw bytes (for re-encryption to another user)
   */
  async decryptRoomKeyToRawBytes(encryptedRoomKey: string): Promise<ArrayBuffer> {
    if (!this.privateKey) {
      throw new Error('KeyManager not initialized');
    }
    return decryptRoomKeyToBytes(encryptedRoomKey, this.privateKey);
  }

  /**
   * Export a CryptoKey room key to raw bytes
   */
  async exportRoomKeyToBytes(roomKey: CryptoKey): Promise<ArrayBuffer> {
    return exportRoomKey(roomKey);
  }

  /**
   * Encrypt room key bytes for a specific user's public key
   */
  async encryptRoomKeyForUser(
    roomKeyBytes: ArrayBuffer,
    userPublicKeyPem: string
  ): Promise<string> {
    return encryptRoomKeyForUserFn(roomKeyBytes, userPublicKeyPem);
  }
}

// Singleton instance
export const keyManager = new KeyManager();
export default keyManager;
