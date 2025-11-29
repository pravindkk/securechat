/**
 * Web Worker for Message Decryption
 *
 * Offloads CPU-intensive cryptographic operations from the main thread
 * to prevent UI blocking during message decryption.
 */

// Inline crypto utilities (workers can't import from main bundle)
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = base64ToArrayBuffer(pemContents);

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['decrypt']
  );
}

async function decryptRoomKey(
  encryptedRoomKey: string,
  privateKey: CryptoKey
): Promise<CryptoKey> {
  const encryptedBytes = base64ToArrayBuffer(encryptedRoomKey);

  const decryptedKeyBytes = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedBytes
  );

  return crypto.subtle.importKey(
    'raw',
    decryptedKeyBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function aesDecrypt(
  key: CryptoKey,
  ciphertext: string,
  iv: string,
  authTag: string
): Promise<string> {
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(ciphertext));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(authTag));
  const ivBytes = new Uint8Array(base64ToArrayBuffer(iv));

  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes);
  combined.set(authTagBytes, ciphertextBytes.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    combined
  );

  return bytesToString(new Uint8Array(decrypted));
}

// Message types for worker communication
interface DecryptRequest {
  type: 'decrypt';
  id: string;
  messageId: string;
  encryptedContent: string;
  iv: string;
  authTag: string;
  encryptedRoomKey: string;
  privateKeyPem: string;
  roomId: string;
  keyVersion?: number;
}

interface InitRequest {
  type: 'init';
  privateKeyPem: string;
}

interface DecryptBatchRequest {
  type: 'decryptBatch';
  id: string;
  messages: Array<{
    messageId: string;
    encryptedContent: string;
    iv: string;
    authTag: string;
    encryptedRoomKey: string;
    roomId: string;
    keyVersion?: number;
  }>;
  privateKeyPem: string;
}

type WorkerRequest = DecryptRequest | InitRequest | DecryptBatchRequest;

// Cache for room keys (keyed by roomId or roomId:version)
const roomKeyCache = new Map<string, CryptoKey>();
let cachedPrivateKey: CryptoKey | null = null;
let cachedPrivateKeyPem: string | null = null;

async function getPrivateKey(pem: string): Promise<CryptoKey> {
  if (cachedPrivateKey && cachedPrivateKeyPem === pem) {
    return cachedPrivateKey;
  }
  cachedPrivateKey = await importPrivateKey(pem);
  cachedPrivateKeyPem = pem;
  return cachedPrivateKey;
}

async function getRoomKey(
  roomId: string,
  encryptedRoomKey: string,
  privateKey: CryptoKey,
  keyVersion?: number
): Promise<CryptoKey> {
  const cacheKey = keyVersion ? `${roomId}:${keyVersion}` : roomId;

  if (roomKeyCache.has(cacheKey)) {
    return roomKeyCache.get(cacheKey)!;
  }

  const roomKey = await decryptRoomKey(encryptedRoomKey, privateKey);
  roomKeyCache.set(cacheKey, roomKey);
  return roomKey;
}

async function decryptMessage(
  encryptedContent: string,
  iv: string,
  authTag: string,
  encryptedRoomKey: string,
  privateKeyPem: string,
  roomId: string,
  keyVersion?: number
): Promise<string> {
  const privateKey = await getPrivateKey(privateKeyPem);
  const roomKey = await getRoomKey(roomId, encryptedRoomKey, privateKey, keyVersion);
  return aesDecrypt(roomKey, encryptedContent, iv, authTag);
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'init': {
        // Pre-initialize with private key
        cachedPrivateKey = await importPrivateKey(request.privateKeyPem);
        cachedPrivateKeyPem = request.privateKeyPem;
        self.postMessage({ type: 'initialized', success: true });
        break;
      }

      case 'decrypt': {
        const decryptedContent = await decryptMessage(
          request.encryptedContent,
          request.iv,
          request.authTag,
          request.encryptedRoomKey,
          request.privateKeyPem,
          request.roomId,
          request.keyVersion
        );

        self.postMessage({
          type: 'decrypted',
          id: request.id,
          messageId: request.messageId,
          decryptedContent,
          success: true,
        });
        break;
      }

      case 'decryptBatch': {
        const results: Array<{ messageId: string; decryptedContent: string; error?: string }> = [];

        for (const msg of request.messages) {
          try {
            const decryptedContent = await decryptMessage(
              msg.encryptedContent,
              msg.iv,
              msg.authTag,
              msg.encryptedRoomKey,
              request.privateKeyPem,
              msg.roomId,
              msg.keyVersion
            );
            results.push({ messageId: msg.messageId, decryptedContent });
          } catch (error) {
            results.push({
              messageId: msg.messageId,
              decryptedContent: '[Decryption failed]',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        self.postMessage({
          type: 'batchDecrypted',
          id: request.id,
          results,
          success: true,
        });
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: (request as DecryptRequest).id,
      messageId: (request as DecryptRequest).messageId,
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false,
    });
  }
};

// Export empty object for TypeScript
export {};
