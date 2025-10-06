import 'react-native-get-random-values';
import { randomBytes } from '@stablelib/random';
import { sharedKey, scalarMultBase, SECRET_KEY_LENGTH, SHARED_KEY_LENGTH } from '@stablelib/x25519';
import { HKDF } from '@stablelib/hkdf';
import { SHA256 } from '@stablelib/sha256';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { encode as encodeBase64, decode as decodeBase64 } from '@stablelib/base64';
import { encode as encodeUTF8, decode as decodeUTF8 } from '@stablelib/utf8';

// Utility function
function concatArrayBuffers(...buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }
  return result;
}

// X25519 key generation using @stablelib/x25519
function generateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = randomBytes(SECRET_KEY_LENGTH);
  const publicKey = scalarMultBase(privateKey);
  return { privateKey, publicKey };
}

// Compute shared secret using X25519
function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return sharedKey(privateKey, publicKey);
}

// HKDF implementation using @stablelib/hkdf
function hkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number
): Uint8Array {
  const hkdfInstance = new HKDF(SHA256, inputKeyMaterial, salt, encodeUTF8(info));
  return hkdfInstance.expand(length);
}

// KDF Chain
function kdfChain(chainKey: Uint8Array): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const messageKey = hkdf(chainKey, new Uint8Array(SHARED_KEY_LENGTH), 'msg', SHARED_KEY_LENGTH);
  const nextChainKey = hkdf(chainKey, new Uint8Array(SHARED_KEY_LENGTH), 'chain', SHARED_KEY_LENGTH);
  return { messageKey, nextChainKey };
}

// XChaCha20-Poly1305 encryption using @stablelib/xchacha20poly1305
function aeadEncrypt(key: Uint8Array, plaintext: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const cipher = new XChaCha20Poly1305(key);
  const nonce = randomBytes(24); // XChaCha20-Poly1305 uses 24-byte nonces
  const ciphertext = cipher.seal(nonce, plaintext);
  return { nonce, ciphertext };
}

// XChaCha20-Poly1305 decryption using @stablelib/xchacha20poly1305
function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const cipher = new XChaCha20Poly1305(key);
  const plaintext = cipher.open(nonce, ciphertext);
  if (plaintext === null) {
    throw new Error('Decryption failed: authentication tag mismatch');
  }
  return plaintext;
}

// Double Ratchet State
export interface RatchetState {
  DHs: { privateKey: Uint8Array; publicKey: Uint8Array } | null; // DH sending key pair
  DHr: Uint8Array | null; // DH receiving public key
  RK: Uint8Array; // Root key
  CKs: Uint8Array; // Sending chain key
  CKr: Uint8Array; // Receiving chain key
  Ns: number; // Message number for sending
  Nr: number; // Message number for receiving
  PN: number; // Previous chain length
  MKSKIPPED: Map<string, Uint8Array>; // Skipped message keys
}

// Initialize Alice's state (initiator)
export function initializeAlice(sharedSecret: Uint8Array, bobPublicKey: Uint8Array): RatchetState {
  const DHs = generateKeyPair();
  const dh = computeSharedSecret(DHs.privateKey, bobPublicKey);

  // Perform initial DH ratchet to derive root key and sending chain key
  const rootKey = hkdf(sharedSecret, new Uint8Array(SHARED_KEY_LENGTH), 'root', SHARED_KEY_LENGTH);
  const newRootKey = hkdf(concatArrayBuffers(rootKey, dh), new Uint8Array(SHARED_KEY_LENGTH), 'root', SHARED_KEY_LENGTH);
  const sendingChainKey = hkdf(concatArrayBuffers(newRootKey, dh), new Uint8Array(SHARED_KEY_LENGTH), 'chain', SHARED_KEY_LENGTH);

  return {
    DHs,
    DHr: bobPublicKey,
    RK: newRootKey,
    CKs: sendingChainKey,
    CKr: new Uint8Array(SHARED_KEY_LENGTH),
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

// Initialize Bob's state (responder)
export function initializeBob(sharedSecret: Uint8Array, bobKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }): RatchetState {
  const rootKey = hkdf(sharedSecret, new Uint8Array(SHARED_KEY_LENGTH), 'root', SHARED_KEY_LENGTH);

  return {
    DHs: bobKeyPair,
    DHr: null,
    RK: rootKey,
    CKs: new Uint8Array(SHARED_KEY_LENGTH),
    CKr: new Uint8Array(SHARED_KEY_LENGTH),
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

// DH Ratchet step
function dhRatchet(state: RatchetState, receivedPublicKey: Uint8Array): void {
  state.PN = state.Ns;
  state.Ns = 0;
  state.Nr = 0;
  state.DHr = receivedPublicKey;

  // Perform DH with received public key to get receiving chain key
  if (state.DHs) {
    const dh = computeSharedSecret(state.DHs.privateKey, receivedPublicKey);
    const newRootKey = hkdf(concatArrayBuffers(state.RK, dh), new Uint8Array(SHARED_KEY_LENGTH), 'root', SHARED_KEY_LENGTH);
    state.CKr = hkdf(concatArrayBuffers(newRootKey, dh), new Uint8Array(SHARED_KEY_LENGTH), 'chain', SHARED_KEY_LENGTH);
    state.RK = newRootKey;
  }

  // Generate new sending key pair
  state.DHs = generateKeyPair();

  // Perform DH with received public key to get sending chain key
  const dh = computeSharedSecret(state.DHs.privateKey, receivedPublicKey);
  const newRootKey = hkdf(concatArrayBuffers(state.RK, dh), new Uint8Array(SHARED_KEY_LENGTH), 'root', SHARED_KEY_LENGTH);
  state.CKs = hkdf(concatArrayBuffers(newRootKey, dh), new Uint8Array(SHARED_KEY_LENGTH), 'chain', SHARED_KEY_LENGTH);
  state.RK = newRootKey;
}

// Encrypt message
export function ratchetEncrypt(state: RatchetState, plaintext: string): string {
  const { messageKey, nextChainKey } = kdfChain(state.CKs);
  state.CKs = nextChainKey;

  const plaintextBytes = encodeUTF8(plaintext);
  const { nonce, ciphertext } = aeadEncrypt(messageKey, plaintextBytes);

  const header = {
    publicKey: state.DHs ? encodeBase64(state.DHs.publicKey) : '',
    pn: state.PN,
    n: state.Ns
  };

  state.Ns += 1;

  return JSON.stringify({
    header,
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(ciphertext)
  });
}

// Decrypt message
export function ratchetDecrypt(state: RatchetState, encryptedMessage: string): string {
  const message = JSON.parse(encryptedMessage);
  const header = message.header;
  const receivedPublicKey = decodeBase64(header.publicKey);

  // Check if we need to perform DH ratchet
  if (state.DHr === null || encodeBase64(state.DHr) !== header.publicKey) {
    dhRatchet(state, receivedPublicKey);
  }

  // Skip message keys if needed
  while (state.Nr < header.n) {
    const { messageKey, nextChainKey } = kdfChain(state.CKr);
    state.MKSKIPPED.set(`${header.publicKey}-${state.Nr}`, messageKey);
    state.CKr = nextChainKey;
    state.Nr += 1;
  }

  const { messageKey, nextChainKey } = kdfChain(state.CKr);
  state.CKr = nextChainKey;
  state.Nr += 1;

  const nonce = decodeBase64(message.nonce);
  const ciphertext = decodeBase64(message.ciphertext);
  const plaintext = aeadDecrypt(messageKey, nonce, ciphertext);

  return decodeUTF8(plaintext);
}

// Helper to serialize/deserialize state for storage
export function serializeState(state: RatchetState): string {
  return JSON.stringify({
    DHs: state.DHs ? {
      privateKey: encodeBase64(state.DHs.privateKey),
      publicKey: encodeBase64(state.DHs.publicKey)
    } : null,
    DHr: state.DHr ? encodeBase64(state.DHr) : null,
    RK: encodeBase64(state.RK),
    CKs: encodeBase64(state.CKs),
    CKr: encodeBase64(state.CKr),
    Ns: state.Ns,
    Nr: state.Nr,
    PN: state.PN,
    MKSKIPPED: Array.from(state.MKSKIPPED.entries()).map(([k, v]) => [k, encodeBase64(v)])
  });
}

export function deserializeState(serialized: string): RatchetState {
  const obj = JSON.parse(serialized);
  return {
    DHs: obj.DHs ? {
      privateKey: decodeBase64(obj.DHs.privateKey),
      publicKey: decodeBase64(obj.DHs.publicKey)
    } : null,
    DHr: obj.DHr ? decodeBase64(obj.DHr) : null,
    RK: decodeBase64(obj.RK),
    CKs: decodeBase64(obj.CKs),
    CKr: decodeBase64(obj.CKr),
    Ns: obj.Ns,
    Nr: obj.Nr,
    PN: obj.PN,
    MKSKIPPED: new Map(obj.MKSKIPPED.map(([k, v]: [string, string]) => [k, decodeBase64(v)]))
  };
}

// Generate initial shared secret (simplified X3DH)
export function generateSharedSecret(): { sharedSecret: Uint8Array; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } } {
  const keyPair = generateKeyPair();
  const sharedSecret = randomBytes(SHARED_KEY_LENGTH);

  return { sharedSecret, keyPair };
}
