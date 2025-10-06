import 'react-native-get-random-values';
import { randomBytes } from '@stablelib/random';
import { sharedKey, scalarMultBase, SECRET_KEY_LENGTH, SHARED_KEY_LENGTH } from '@stablelib/x25519';
import { HKDF } from '@stablelib/hkdf';
import { SHA256 } from '@stablelib/sha256';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { encode as encodeBase64, decode as decodeBase64 } from '@stablelib/base64';
import { encode as encodeUTF8, decode as decodeUTF8 } from '@stablelib/utf8';

// Constants
const MAX_SKIP = 1000; // Maximum number of message keys to skip

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

// X25519 key generation
function generateDHKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = randomBytes(SECRET_KEY_LENGTH);
  const publicKey = scalarMultBase(privateKey);
  return { privateKey, publicKey };
}

// Compute shared secret using X25519
function DH(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return sharedKey(privateKey, publicKey);
}

// HKDF wrapper for general use
function hkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number
): Uint8Array {
  const hkdfInstance = new HKDF(SHA256, inputKeyMaterial, salt, encodeUTF8(info));
  return hkdfInstance.expand(length);
}

// KDF_RK: Root key KDF - returns new root key and chain key
function KDF_RK(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
  // Signal spec: Use HKDF with the DH output as input key material
  const output = hkdf(
    dhOutput,
    rootKey,
    'SignalDoubleRatchet',
    SHARED_KEY_LENGTH * 2 // 64 bytes: 32 for RK, 32 for CK
  );

  return {
    rootKey: output.slice(0, SHARED_KEY_LENGTH),
    chainKey: output.slice(SHARED_KEY_LENGTH, SHARED_KEY_LENGTH * 2)
  };
}

// KDF_CK: Chain key KDF - returns message key and next chain key
function KDF_CK(chainKey: Uint8Array): { messageKey: Uint8Array; chainKey: Uint8Array } {
  // Use HMAC-based KDF for symmetric ratchet
  const messageKey = hkdf(chainKey, new Uint8Array(SHARED_KEY_LENGTH), 'MessageKey', SHARED_KEY_LENGTH);
  const nextChainKey = hkdf(chainKey, new Uint8Array(SHARED_KEY_LENGTH), 'ChainKey', SHARED_KEY_LENGTH);
  return { messageKey, chainKey: nextChainKey };
}

// Encrypt with AEAD including associated data
function ENCRYPT(
  messageKey: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const cipher = new XChaCha20Poly1305(messageKey);
  const nonce = randomBytes(24); // XChaCha20-Poly1305 uses 24-byte nonces
  const ciphertext = cipher.seal(nonce, plaintext, associatedData);
  return { nonce, ciphertext };
}

// Decrypt with AEAD including associated data
function DECRYPT(
  messageKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData: Uint8Array
): Uint8Array {
  const cipher = new XChaCha20Poly1305(messageKey);
  const plaintext = cipher.open(nonce, ciphertext, associatedData);
  if (plaintext === null) {
    throw new Error('Decryption failed: authentication tag mismatch');
  }
  return plaintext;
}

// Header structure
interface MessageHeader {
  publicKey: string; // Base64 encoded DH public key
  pn: number; // Previous chain length
  n: number; // Message number
}

// Encode header for use as associated data
function encodeHeader(header: MessageHeader): Uint8Array {
  return encodeUTF8(JSON.stringify(header));
}

// Double Ratchet State
export interface RatchetState {
  DHs: { privateKey: Uint8Array; publicKey: Uint8Array } | null; // DH sending key pair
  DHr: Uint8Array | null; // DH receiving public key
  RK: Uint8Array; // Root key
  CKs: Uint8Array | null; // Sending chain key
  CKr: Uint8Array | null; // Receiving chain key
  Ns: number; // Message number for sending
  Nr: number; // Message number for receiving
  PN: number; // Previous chain length
  MKSKIPPED: Map<string, Uint8Array>; // Skipped message keys
}

// Initialize Alice's state (initiator) - FIXED per Signal spec
export function initializeAlice(sharedSecret: Uint8Array, bobPublicKey: Uint8Array): RatchetState {
  // Alice initializes with Bob's prekey but doesn't perform DH ratchet yet
  // The DH ratchet happens on first message send
  const rootKey = hkdf(sharedSecret, new Uint8Array(SHARED_KEY_LENGTH), 'SignalRoot', SHARED_KEY_LENGTH);

  // Generate Alice's initial DH keypair
  const DHs = generateDHKeyPair();

  // Perform first DH ratchet to get sending chain
  const dhOutput = DH(DHs.privateKey, bobPublicKey);
  const { rootKey: newRootKey, chainKey: sendingChainKey } = KDF_RK(rootKey, dhOutput);

  return {
    DHs,
    DHr: bobPublicKey,
    RK: newRootKey,
    CKs: sendingChainKey,
    CKr: null, // No receiving chain yet
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

// Initialize Bob's state (responder)
export function initializeBob(sharedSecret: Uint8Array, bobKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }): RatchetState {
  const rootKey = hkdf(sharedSecret, new Uint8Array(SHARED_KEY_LENGTH), 'SignalRoot', SHARED_KEY_LENGTH);

  return {
    DHs: bobKeyPair,
    DHr: null, // Bob doesn't know Alice's DH key yet
    RK: rootKey,
    CKs: null, // No sending chain yet
    CKr: null, // No receiving chain yet
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

// DH Ratchet step - FIXED per Signal spec
function DHRatchet(state: RatchetState, header: MessageHeader): void {
  const receivedPublicKey = decodeBase64(header.publicKey);

  // Save previous chain length
  state.PN = state.Ns;
  state.Ns = 0;
  state.Nr = 0;
  state.DHr = receivedPublicKey;

  // Step 1: Perform DH with old sending key to derive receiving chain
  // RK, CKr = KDF_RK(RK, DH(DHs, DHr_new))
  if (state.DHs) {
    const dhOutput = DH(state.DHs.privateKey, receivedPublicKey);
    const { rootKey: newRootKey, chainKey: receivingChainKey } = KDF_RK(state.RK, dhOutput);
    state.RK = newRootKey;
    state.CKr = receivingChainKey;
  }

  // Step 2: Generate new sending key pair
  state.DHs = generateDHKeyPair();

  // Step 3: Perform DH with new sending key to derive sending chain
  // RK, CKs = KDF_RK(RK, DH(DHs_new, DHr_new))
  const dhOutput = DH(state.DHs.privateKey, receivedPublicKey);
  const { rootKey: finalRootKey, chainKey: sendingChainKey } = KDF_RK(state.RK, dhOutput);
  state.RK = finalRootKey;
  state.CKs = sendingChainKey;
}

// Try to decrypt with skipped message key
function trySkippedMessageKeys(
  state: RatchetState,
  header: MessageHeader,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array | null {
  const key = `${header.publicKey}-${header.n}`;
  const messageKey = state.MKSKIPPED.get(key);

  if (messageKey) {
    // Found skipped key, use it
    state.MKSKIPPED.delete(key);
    const headerBytes = encodeHeader(header);
    return DECRYPT(messageKey, nonce, ciphertext, headerBytes);
  }

  return null;
}

// Skip message keys in current receiving chain
function skipMessageKeys(state: RatchetState, until: number): void {
  // If no receiving chain exists yet, nothing to skip
  if (!state.CKr) {
    return;
  }

  if (state.Nr + MAX_SKIP < until) {
    throw new Error(`Too many message keys to skip: ${until - state.Nr} > ${MAX_SKIP}`);
  }

  if (state.DHr && state.CKr) {
    while (state.Nr < until) {
      const { messageKey, chainKey } = KDF_CK(state.CKr);
      const key = `${encodeBase64(state.DHr)}-${state.Nr}`;
      state.MKSKIPPED.set(key, messageKey);
      state.CKr = chainKey;
      state.Nr += 1;
    }
  }
}

// Encrypt message - with proper AD
export function ratchetEncrypt(state: RatchetState, plaintext: string): string {
  if (!state.CKs || !state.DHs) {
    throw new Error('Cannot encrypt: sending chain not initialized');
  }

  const { messageKey, chainKey } = KDF_CK(state.CKs);
  state.CKs = chainKey;

  const header: MessageHeader = {
    publicKey: encodeBase64(state.DHs.publicKey),
    pn: state.PN,
    n: state.Ns
  };

  state.Ns += 1;

  const plaintextBytes = encodeUTF8(plaintext);
  const headerBytes = encodeHeader(header);
  const { nonce, ciphertext } = ENCRYPT(messageKey, plaintextBytes, headerBytes);

  return JSON.stringify({
    header,
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(ciphertext)
  });
}

// Decrypt message - FIXED with skipped message key handling
export function ratchetDecrypt(state: RatchetState, encryptedMessage: string): string {
  const message = JSON.parse(encryptedMessage);
  const header: MessageHeader = message.header;
  const nonce = decodeBase64(message.nonce);
  const ciphertext = decodeBase64(message.ciphertext);

  // Check if this is a skipped message
  const skippedPlaintext = trySkippedMessageKeys(state, header, nonce, ciphertext);
  if (skippedPlaintext) {
    return decodeUTF8(skippedPlaintext);
  }

  // Check if we need to perform DH ratchet (new DH key from sender)
  const receivedPublicKey = decodeBase64(header.publicKey);
  if (state.DHr === null || encodeBase64(state.DHr) !== header.publicKey) {
    // Skip message keys from previous receiving chain
    skipMessageKeys(state, header.pn);

    // Perform DH ratchet
    DHRatchet(state, header);
  }

  // Skip message keys in current receiving chain
  skipMessageKeys(state, header.n);

  // Decrypt the message
  if (!state.CKr) {
    throw new Error('Cannot decrypt: receiving chain not initialized');
  }

  const { messageKey, chainKey } = KDF_CK(state.CKr);
  state.CKr = chainKey;
  state.Nr += 1;

  const headerBytes = encodeHeader(header);
  const plaintext = DECRYPT(messageKey, nonce, ciphertext, headerBytes);

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
    CKs: state.CKs ? encodeBase64(state.CKs) : null,
    CKr: state.CKr ? encodeBase64(state.CKr) : null,
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
    CKs: obj.CKs ? decodeBase64(obj.CKs) : null,
    CKr: obj.CKr ? decodeBase64(obj.CKr) : null,
    Ns: obj.Ns,
    Nr: obj.Nr,
    PN: obj.PN,
    MKSKIPPED: new Map(obj.MKSKIPPED.map(([k, v]: [string, string]) => [k, decodeBase64(v)]))
  };
}

// Generate initial shared secret (simplified X3DH)
// Note: For production, implement proper X3DH with signed prekeys and one-time prekeys
export function generateSharedSecret(): { sharedSecret: Uint8Array; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } } {
  const keyPair = generateDHKeyPair();
  const sharedSecret = randomBytes(SHARED_KEY_LENGTH);

  return { sharedSecret, keyPair };
}
