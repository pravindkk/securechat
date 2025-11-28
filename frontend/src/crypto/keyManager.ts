/**
 * Key Manager for Secure Chat
 * 
 * Manages:
 * - User's RSA private key (stored encrypted, decrypted in memory)
 * - Room keys (cached after decryption)
 * - Message encryption/decryption
 */

import {
  importPrivateKey,
  decryptRoomKey,
  aesEncrypt,
  aesDecrypt,
  decryptPrivateKey,
} from './encryption';

class KeyManager {
  private privateKey: CryptoKey | null = null;
  private roomKeys: Map<string, CryptoKey> = new Map();
  private privateKeyPem: string | null = null;

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
   */
  async reinitialize(privateKeyPem: string): Promise<void> {
    this.privateKeyPem = privateKeyPem;
    this.privateKey = await importPrivateKey(privateKeyPem);
    console.log('[KeyManager] Re-initialized with stored private key');
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
    console.log('[KeyManager] Cleared all keys');
  }

  /**
   * Get or decrypt a room key
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
   * Clear a specific room key (when room key is rotated)
   */
  clearRoomKey(roomId: string): void {
    this.roomKeys.delete(roomId);
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
}

// Singleton instance
export const keyManager = new KeyManager();
export default keyManager;
