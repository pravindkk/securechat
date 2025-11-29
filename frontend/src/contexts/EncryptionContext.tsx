/**
 * Encryption Context
 *
 * Manages encryption/decryption operations using Web Worker for performance.
 * Provides room key management and message encryption/decryption.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { Message, RoomMember } from '../types';
import { keyManager } from '../crypto/keyManager';
import { decryptionWorker } from '../workers/DecryptionWorkerManager';
import { api } from '../services/api';

interface EncryptionContextType {
  isInitialized: boolean;
  isRotatingKey: boolean;
  setIsRotatingKey: (value: boolean) => void;
  initializeEncryption: (privateKeyPem: string) => Promise<void>;
  clearEncryption: () => void;
  encryptMessage: (
    roomId: string,
    members: RoomMember[],
    content: string
  ) => Promise<{ ciphertext: string; iv: string; authTag: string; keyVersion?: number }>;
  decryptMessage: (
    message: Message,
    roomId: string,
    members: RoomMember[]
  ) => Promise<Message>;
  decryptMessages: (
    messages: Message[],
    roomId: string,
    members: RoomMember[]
  ) => Promise<Message[]>;
  getEncryptedRoomKey: (roomId: string, members: RoomMember[]) => Promise<string>;
  clearRoomKey: (roomId: string) => void;
  clearAllRoomKeys: (roomId: string) => void;
  // For group operations
  decryptRoomKeyToRawBytes: (encryptedRoomKey: string) => Promise<ArrayBuffer>;
  encryptRoomKeyForUser: (roomKeyBytes: ArrayBuffer, publicKeyPem: string) => Promise<string>;
  generateNewRoomKey: () => Promise<CryptoKey>;
  exportRoomKeyToBytes: (roomKey: CryptoKey) => Promise<ArrayBuffer>;
}

const EncryptionContext = createContext<EncryptionContextType | null>(null);

export const useEncryption = (): EncryptionContextType => {
  const context = useContext(EncryptionContext);
  if (!context) {
    throw new Error('useEncryption must be used within an EncryptionProvider');
  }
  return context;
};

interface EncryptionProviderProps {
  children: ReactNode;
  userId?: string;
}

export const EncryptionProvider: React.FC<EncryptionProviderProps> = ({
  children,
  userId,
}) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRotatingKey, setIsRotatingKey] = useState(false);
  const roomKeysCache = useRef<Map<string, string>>(new Map());

  // Initialize encryption with the user's private key
  const initializeEncryption = useCallback(async (privateKeyPem: string) => {
    try {
      // Initialize keyManager (for encryption)
      await keyManager.reinitialize(privateKeyPem);

      // Initialize Web Worker (for decryption)
      await decryptionWorker.initialize(privateKeyPem);

      setIsInitialized(true);
      console.log('[EncryptionContext] Initialized with private key');
    } catch (error) {
      console.error('[EncryptionContext] Initialization failed:', error);
      throw error;
    }
  }, []);

  // Clear all encryption state
  const clearEncryption = useCallback(() => {
    keyManager.clear();
    decryptionWorker.terminate();
    roomKeysCache.current.clear();
    setIsInitialized(false);
    setIsRotatingKey(false);
    console.log('[EncryptionContext] Cleared all encryption state');
  }, []);

  // Get encrypted room key for current user
  const getEncryptedRoomKey = useCallback(
    async (roomId: string, members: RoomMember[]): Promise<string> => {
      if (!keyManager.isInitialized()) {
        throw new Error('Encryption not initialized');
      }

      // Check cache first
      if (roomKeysCache.current.has(roomId)) {
        return roomKeysCache.current.get(roomId)!;
      }

      // Find current user's encrypted room key
      const currentMember = members.find((m) => m.id === userId);
      if (currentMember?.encryptedRoomKey) {
        roomKeysCache.current.set(roomId, currentMember.encryptedRoomKey);
        return currentMember.encryptedRoomKey;
      }

      // Fallback: fetch from API
      const response = await api.getRoomKey(roomId);
      if (response.success && response.data) {
        roomKeysCache.current.set(roomId, response.data.encryptedRoomKey);
        return response.data.encryptedRoomKey;
      }

      throw new Error('Failed to get room key');
    },
    [userId]
  );

  // Encrypt a message
  const encryptMessage = useCallback(
    async (
      roomId: string,
      members: RoomMember[],
      content: string
    ): Promise<{ ciphertext: string; iv: string; authTag: string; keyVersion?: number }> => {
      const encryptedRoomKey = await getEncryptedRoomKey(roomId, members);
      const { ciphertext, iv, authTag } = await keyManager.encryptMessage(
        roomId,
        encryptedRoomKey,
        content
      );

      // Get current key version
      const currentMember = members.find((m) => m.id === userId);
      const keyVersion = currentMember?.keyVersion;

      return { ciphertext, iv, authTag, keyVersion };
    },
    [getEncryptedRoomKey, userId]
  );

  // Decrypt a single message (using Web Worker)
  const decryptMessage = useCallback(
    async (message: Message, roomId: string, members: RoomMember[]): Promise<Message> => {
      try {
        // System messages don't need decryption
        if (message.type === 'system') {
          return { ...message, decryptedContent: message.encryptedContent || '' };
        }

        // Own messages - check local cache first
        if (message.senderId === userId) {
          const cachedContent = localStorage.getItem(`msg:${message._id}`);
          if (cachedContent) {
            return { ...message, decryptedContent: cachedContent };
          }
        }

        // Use Web Worker for decryption
        if (decryptionWorker.isReady()) {
          const currentMember = members.find((m) => m.id === userId);
          const encryptedRoomKey = currentMember?.encryptedRoomKey;

          if (!encryptedRoomKey) {
            return { ...message, decryptedContent: '[No room key]' };
          }

          // Handle versioned keys
          const currentKeyVersion = currentMember?.keyVersion || 1;
          if (message.keyVersion && message.keyVersion !== currentKeyVersion) {
            // Fetch historical key
            const keyResponse = await api.getRoomKeyVersion(roomId, message.keyVersion);
            if (keyResponse.success && keyResponse.data) {
              const decryptedContent = await decryptionWorker.decryptMessage(
                { ...message, encryptedContent: message.encryptedContent } as Message,
                keyResponse.data.encryptedRoomKey,
                roomId
              );
              return { ...message, decryptedContent };
            }
            return { ...message, decryptedContent: '[Key version unavailable]' };
          }

          const decryptedContent = await decryptionWorker.decryptMessage(
            message,
            encryptedRoomKey,
            roomId
          );
          return { ...message, decryptedContent };
        }

        // Fallback to main thread (keyManager)
        const encryptedRoomKey = await getEncryptedRoomKey(roomId, members);
        const decryptedContent = await keyManager.decryptMessage(
          roomId,
          encryptedRoomKey,
          message.encryptedContent,
          message.iv,
          message.authTag
        );
        return { ...message, decryptedContent };
      } catch (error) {
        console.error('[EncryptionContext] Decryption failed:', error);
        return { ...message, decryptedContent: '[Decryption failed]' };
      }
    },
    [userId, getEncryptedRoomKey]
  );

  // Decrypt multiple messages in batch (using Web Worker)
  const decryptMessages = useCallback(
    async (messages: Message[], roomId: string, members: RoomMember[]): Promise<Message[]> => {
      if (!decryptionWorker.isReady() || !userId) {
        // Fallback to sequential decryption
        return Promise.all(messages.map((m) => decryptMessage(m, roomId, members)));
      }

      // Separate messages by type
      const systemMessages = messages.filter((m) => m.type === 'system');
      const regularMessages = messages.filter((m) => m.type !== 'system');

      // Check for cached own messages
      const cachedMessages: Message[] = [];
      const toDecrypt: Message[] = [];

      for (const msg of regularMessages) {
        if (msg.senderId === userId) {
          const cached = localStorage.getItem(`msg:${msg._id}`);
          if (cached) {
            cachedMessages.push({ ...msg, decryptedContent: cached });
            continue;
          }
        }
        toDecrypt.push(msg);
      }

      // Decrypt remaining messages using worker
      let decrypted: Message[] = [];
      if (toDecrypt.length > 0) {
        decrypted = await decryptionWorker.decryptMessagesWithMembers(
          toDecrypt,
          roomId,
          members,
          userId
        );
      }

      // Process system messages
      const processedSystem = systemMessages.map((m) => ({
        ...m,
        decryptedContent: m.encryptedContent || '',
      }));

      // Merge and sort by timestamp
      const allMessages = [...processedSystem, ...cachedMessages, ...decrypted];
      return allMessages.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    },
    [userId, decryptMessage]
  );

  // Clear room key cache
  const clearRoomKey = useCallback((roomId: string) => {
    roomKeysCache.current.delete(roomId);
    keyManager.clearRoomKey(roomId);
  }, []);

  // Clear all room keys for a room
  const clearAllRoomKeys = useCallback((roomId: string) => {
    roomKeysCache.current.delete(roomId);
    keyManager.clearAllRoomKeys(roomId);
  }, []);

  // Expose keyManager methods for group operations
  const decryptRoomKeyToRawBytes = useCallback(
    (encryptedRoomKey: string) => keyManager.decryptRoomKeyToRawBytes(encryptedRoomKey),
    []
  );

  const encryptRoomKeyForUser = useCallback(
    (roomKeyBytes: ArrayBuffer, publicKeyPem: string) =>
      keyManager.encryptRoomKeyForUser(roomKeyBytes, publicKeyPem),
    []
  );

  const generateNewRoomKey = useCallback(() => keyManager.generateNewRoomKey(), []);

  const exportRoomKeyToBytes = useCallback(
    (roomKey: CryptoKey) => keyManager.exportRoomKeyToBytes(roomKey),
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      decryptionWorker.terminate();
    };
  }, []);

  return (
    <EncryptionContext.Provider
      value={{
        isInitialized,
        isRotatingKey,
        setIsRotatingKey,
        initializeEncryption,
        clearEncryption,
        encryptMessage,
        decryptMessage,
        decryptMessages,
        getEncryptedRoomKey,
        clearRoomKey,
        clearAllRoomKeys,
        decryptRoomKeyToRawBytes,
        encryptRoomKeyForUser,
        generateNewRoomKey,
        exportRoomKeyToBytes,
      }}
    >
      {children}
    </EncryptionContext.Provider>
  );
};

export default EncryptionProvider;
