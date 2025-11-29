/**
 * Decryption Worker Manager
 *
 * Manages communication with the decryption Web Worker for off-main-thread
 * message decryption. Provides a Promise-based API for easy integration.
 */

import { Message, RoomMember } from '../types';

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

interface BatchPendingRequest {
  resolve: (value: Array<{ messageId: string; decryptedContent: string }>) => void;
  reject: (reason: Error) => void;
}

interface DecryptedResult {
  type: 'decrypted';
  id: string;
  messageId: string;
  decryptedContent: string;
  success: boolean;
}

interface BatchDecryptedResult {
  type: 'batchDecrypted';
  id: string;
  results: Array<{ messageId: string; decryptedContent: string; error?: string }>;
  success: boolean;
}

interface ErrorResult {
  type: 'error';
  id: string;
  messageId: string;
  error: string;
  success: boolean;
}

interface InitializedResult {
  type: 'initialized';
  success: boolean;
}

type WorkerResult = DecryptedResult | BatchDecryptedResult | ErrorResult | InitializedResult;

class DecryptionWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private batchPendingRequests = new Map<string, BatchPendingRequest>();
  private privateKeyPem: string | null = null;
  private requestIdCounter = 0;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the worker with the user's private key
   */
  async initialize(privateKeyPem: string): Promise<void> {
    if (this.isInitialized && this.privateKeyPem === privateKeyPem) {
      return;
    }

    // Terminate existing worker if any
    if (this.worker) {
      this.worker.terminate();
    }

    this.privateKeyPem = privateKeyPem;

    // Create the worker using Vite's worker syntax
    this.worker = new Worker(
      new URL('./decryption.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.initPromise = new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not created'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, 10000);

      const handleMessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.type === 'initialized') {
          clearTimeout(timeout);
          this.isInitialized = true;
          resolve();
        }
      };

      this.worker.addEventListener('message', handleMessage, { once: true });

      this.worker.postMessage({
        type: 'init',
        privateKeyPem,
      });
    });

    // Set up message handler for subsequent messages
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('[DecryptionWorker] Worker error:', error);
      // Reject all pending requests
      for (const [id, request] of this.pendingRequests) {
        request.reject(new Error('Worker error'));
        this.pendingRequests.delete(id);
      }
      for (const [id, request] of this.batchPendingRequests) {
        request.reject(new Error('Worker error'));
        this.batchPendingRequests.delete(id);
      }
    };

    return this.initPromise;
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(result: WorkerResult): void {
    if (result.type === 'initialized') {
      return; // Handled in initialize()
    }

    if (result.type === 'decrypted' || result.type === 'error') {
      const request = this.pendingRequests.get(result.id);
      if (request) {
        this.pendingRequests.delete(result.id);
        if (result.success && result.type === 'decrypted') {
          request.resolve(result.decryptedContent);
        } else {
          request.reject(new Error((result as ErrorResult).error || 'Decryption failed'));
        }
      }
    }

    if (result.type === 'batchDecrypted') {
      const request = this.batchPendingRequests.get(result.id);
      if (request) {
        this.batchPendingRequests.delete(result.id);
        if (result.success) {
          request.resolve(result.results);
        } else {
          request.reject(new Error('Batch decryption failed'));
        }
      }
    }
  }

  /**
   * Generate a unique request ID
   */
  private generateId(): string {
    return `req-${++this.requestIdCounter}-${Date.now()}`;
  }

  /**
   * Decrypt a single message
   */
  async decryptMessage(
    message: Message,
    encryptedRoomKey: string,
    roomId: string
  ): Promise<string> {
    if (!this.worker || !this.privateKeyPem) {
      throw new Error('Worker not initialized');
    }

    // Wait for initialization if still pending
    if (this.initPromise) {
      await this.initPromise;
    }

    const id = this.generateId();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Set timeout for request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Decryption timeout'));
        }
      }, 30000);

      this.worker!.postMessage({
        type: 'decrypt',
        id,
        messageId: message._id,
        encryptedContent: message.encryptedContent,
        iv: message.iv,
        authTag: message.authTag,
        encryptedRoomKey,
        privateKeyPem: this.privateKeyPem,
        roomId,
        keyVersion: message.keyVersion,
      });
    });
  }

  /**
   * Decrypt multiple messages in batch (more efficient)
   */
  async decryptBatch(
    messages: Message[],
    getEncryptedRoomKey: (message: Message) => string,
    roomId: string
  ): Promise<Map<string, string>> {
    if (!this.worker || !this.privateKeyPem) {
      throw new Error('Worker not initialized');
    }

    // Wait for initialization if still pending
    if (this.initPromise) {
      await this.initPromise;
    }

    const id = this.generateId();

    const batchMessages = messages.map((msg) => ({
      messageId: msg._id,
      encryptedContent: msg.encryptedContent,
      iv: msg.iv,
      authTag: msg.authTag,
      encryptedRoomKey: getEncryptedRoomKey(msg),
      roomId,
      keyVersion: msg.keyVersion,
    }));

    return new Promise((resolve, reject) => {
      this.batchPendingRequests.set(id, {
        resolve: (results) => {
          const resultMap = new Map<string, string>();
          for (const r of results) {
            resultMap.set(r.messageId, r.decryptedContent);
          }
          resolve(resultMap);
        },
        reject,
      });

      // Set timeout for batch request
      setTimeout(() => {
        if (this.batchPendingRequests.has(id)) {
          this.batchPendingRequests.delete(id);
          reject(new Error('Batch decryption timeout'));
        }
      }, 60000);

      this.worker!.postMessage({
        type: 'decryptBatch',
        id,
        messages: batchMessages,
        privateKeyPem: this.privateKeyPem,
      });
    });
  }

  /**
   * Helper to decrypt messages with room member data
   */
  async decryptMessagesWithMembers(
    messages: Message[],
    roomId: string,
    members: RoomMember[],
    userId: string
  ): Promise<Message[]> {
    // Find current user's encrypted room key
    const currentMember = members.find((m) => m.id === userId);
    if (!currentMember?.encryptedRoomKey) {
      console.error('No encrypted room key found for current user');
      return messages.map((m) => ({ ...m, decryptedContent: '[No room key]' }));
    }

    // Filter messages that need decryption (not system, not already decrypted)
    const messagesToDecrypt = messages.filter(
      (m) => m.type !== 'system' && !m.decryptedContent
    );

    if (messagesToDecrypt.length === 0) {
      return messages;
    }

    try {
      const decryptedMap = await this.decryptBatch(
        messagesToDecrypt,
        () => currentMember.encryptedRoomKey!,
        roomId
      );

      return messages.map((m) => {
        if (m.type === 'system') {
          return { ...m, decryptedContent: m.encryptedContent || '' };
        }
        const decrypted = decryptedMap.get(m._id);
        if (decrypted) {
          return { ...m, decryptedContent: decrypted };
        }
        return m;
      });
    } catch (error) {
      console.error('[DecryptionWorker] Batch decryption failed:', error);
      return messages.map((m) => ({
        ...m,
        decryptedContent: m.decryptedContent || '[Decryption failed]',
      }));
    }
  }

  /**
   * Clear cache and terminate worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.privateKeyPem = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.pendingRequests.clear();
    this.batchPendingRequests.clear();
  }

  /**
   * Check if worker is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.worker !== null;
  }
}

// Singleton instance
export const decryptionWorker = new DecryptionWorkerManager();
export default decryptionWorker;
