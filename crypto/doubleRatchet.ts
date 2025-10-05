import * as Crypto from 'expo-crypto';
import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import CryptoJS from 'crypto-js';

// Utility functions
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

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

// Convert Uint8Array to CryptoJS WordArray
function uint8ArrayToWordArray(u8Array: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < u8Array.length; i += 4) {
    words.push(
      (u8Array[i] << 24) |
      (u8Array[i + 1] << 16) |
      (u8Array[i + 2] << 8) |
      u8Array[i + 3]
    );
  }
  return CryptoJS.lib.WordArray.create(words, u8Array.length);
}

// Convert CryptoJS WordArray to Uint8Array
function wordArrayToUint8Array(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const words = wordArray.words;
  const sigBytes = wordArray.sigBytes;
  const u8 = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return u8;
}

// PKCS7 padding
function pkcs7Pad(data: Uint8Array, blockSize: number = 16): Uint8Array {
  const paddingLength = blockSize - (data.length % blockSize);
  const padding = new Uint8Array(paddingLength).fill(paddingLength);
  return concatArrayBuffers(data, padding);
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const paddingLength = data[data.length - 1];
  return data.slice(0, data.length - paddingLength);
}

// X25519 key generation using TweetNaCl
function generateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const keyPair = nacl.box.keyPair();
  return {
    privateKey: keyPair.secretKey,
    publicKey: keyPair.publicKey
  };
}

// Compute shared secret using X25519
function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  // Use nacl.scalarMult for X25519 DH
  return nacl.scalarMult(privateKey.slice(0, 32), publicKey);
}

// HKDF implementation using CryptoJS
function hkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  // HKDF-Extract
  const saltWord = salt.length > 0 ? uint8ArrayToWordArray(salt) : CryptoJS.lib.WordArray.create();
  const ikmWord = uint8ArrayToWordArray(inputKeyMaterial);
  const prk = CryptoJS.HmacSHA256(ikmWord, saltWord);

  // HKDF-Expand
  const infoWord = uint8ArrayToWordArray(info);
  const hashLen = 32; // SHA-256 output length
  const n = Math.ceil(length / hashLen);
  let t = CryptoJS.lib.WordArray.create();
  let okm = CryptoJS.lib.WordArray.create();

  for (let i = 1; i <= n; i++) {
    t = CryptoJS.HmacSHA256(
      t.concat(infoWord).concat(CryptoJS.lib.WordArray.create([i << 24], 1)),
      prk
    );
    okm = okm.concat(t);
  }

  return wordArrayToUint8Array(okm).slice(0, length);
}

// KDF Chain
function kdfChain(chainKey: Uint8Array): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const messageKey = hkdf(chainKey, new Uint8Array(32), new TextEncoder().encode('msg'), 32);
  const nextChainKey = hkdf(chainKey, new Uint8Array(32), new TextEncoder().encode('chain'), 32);
  return { messageKey, nextChainKey };
}

// AES-CBC encryption using CryptoJS
function aesEncrypt(key: Uint8Array, plaintext: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv);

  const keyWord = uint8ArrayToWordArray(key);
  const ivWord = uint8ArrayToWordArray(iv);
  const plaintextWord = uint8ArrayToWordArray(pkcs7Pad(plaintext));

  const encrypted = CryptoJS.AES.encrypt(plaintextWord, keyWord, {
    iv: ivWord,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.NoPadding
  });

  const ciphertext = wordArrayToUint8Array(encrypted.ciphertext);

  return { iv, ciphertext };
}

// AES-CBC decryption using CryptoJS
function aesDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const keyWord = uint8ArrayToWordArray(key);
  const ivWord = uint8ArrayToWordArray(iv);
  const ciphertextWord = uint8ArrayToWordArray(ciphertext);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: ciphertextWord } as any,
    keyWord,
    {
      iv: ivWord,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding
    }
  );

  return pkcs7Unpad(wordArrayToUint8Array(decrypted));
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
  const rootKey = hkdf(sharedSecret, new Uint8Array(32), new TextEncoder().encode('root'), 32);
  const newRootKey = hkdf(concatArrayBuffers(rootKey, dh), new Uint8Array(32), new TextEncoder().encode('root'), 32);
  const sendingChainKey = hkdf(concatArrayBuffers(newRootKey, dh), new Uint8Array(32), new TextEncoder().encode('chain'), 32);

  return {
    DHs,
    DHr: bobPublicKey,
    RK: newRootKey,
    CKs: sendingChainKey,
    CKr: new Uint8Array(32),
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

// Initialize Bob's state (responder)
export function initializeBob(sharedSecret: Uint8Array, bobKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }): RatchetState {
  const rootKey = hkdf(sharedSecret, new Uint8Array(32), new TextEncoder().encode('root'), 32);

  return {
    DHs: bobKeyPair,
    DHr: null,
    RK: rootKey,
    CKs: new Uint8Array(32),
    CKr: new Uint8Array(32),
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
    const newRootKey = hkdf(concatArrayBuffers(state.RK, dh), new Uint8Array(32), new TextEncoder().encode('root'), 32);
    state.CKr = hkdf(concatArrayBuffers(newRootKey, dh), new Uint8Array(32), new TextEncoder().encode('chain'), 32);
    state.RK = newRootKey;
  }

  // Generate new sending key pair
  state.DHs = generateKeyPair();

  // Perform DH with received public key to get sending chain key
  const dh = computeSharedSecret(state.DHs.privateKey, receivedPublicKey);
  const newRootKey = hkdf(concatArrayBuffers(state.RK, dh), new Uint8Array(32), new TextEncoder().encode('root'), 32);
  state.CKs = hkdf(concatArrayBuffers(newRootKey, dh), new Uint8Array(32), new TextEncoder().encode('chain'), 32);
  state.RK = newRootKey;
}

// Encrypt message
export function ratchetEncrypt(state: RatchetState, plaintext: string): string {
  const { messageKey, nextChainKey } = kdfChain(state.CKs);
  state.CKs = nextChainKey;

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const { iv, ciphertext } = aesEncrypt(messageKey, plaintextBytes);

  const header = {
    publicKey: state.DHs ? bytesToBase64(state.DHs.publicKey) : '',
    pn: state.PN,
    n: state.Ns
  };

  state.Ns += 1;

  return JSON.stringify({
    header,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  });
}

// Decrypt message
export function ratchetDecrypt(state: RatchetState, encryptedMessage: string): string {
  const message = JSON.parse(encryptedMessage);
  const header = message.header;
  const receivedPublicKey = base64ToBytes(header.publicKey);

  // Check if we need to perform DH ratchet
  if (state.DHr === null || bytesToBase64(state.DHr) !== header.publicKey) {
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

  const iv = base64ToBytes(message.iv);
  const ciphertext = base64ToBytes(message.ciphertext);
  const plaintext = aesDecrypt(messageKey, iv, ciphertext);

  return new TextDecoder().decode(plaintext);
}

// Helper to serialize/deserialize state for storage
export function serializeState(state: RatchetState): string {
  return JSON.stringify({
    DHs: state.DHs ? {
      privateKey: bytesToBase64(state.DHs.privateKey),
      publicKey: bytesToBase64(state.DHs.publicKey)
    } : null,
    DHr: state.DHr ? bytesToBase64(state.DHr) : null,
    RK: bytesToBase64(state.RK),
    CKs: bytesToBase64(state.CKs),
    CKr: bytesToBase64(state.CKr),
    Ns: state.Ns,
    Nr: state.Nr,
    PN: state.PN,
    MKSKIPPED: Array.from(state.MKSKIPPED.entries()).map(([k, v]) => [k, bytesToBase64(v)])
  });
}

export function deserializeState(serialized: string): RatchetState {
  const obj = JSON.parse(serialized);
  return {
    DHs: obj.DHs ? {
      privateKey: base64ToBytes(obj.DHs.privateKey),
      publicKey: base64ToBytes(obj.DHs.publicKey)
    } : null,
    DHr: obj.DHr ? base64ToBytes(obj.DHr) : null,
    RK: base64ToBytes(obj.RK),
    CKs: base64ToBytes(obj.CKs),
    CKr: base64ToBytes(obj.CKr),
    Ns: obj.Ns,
    Nr: obj.Nr,
    PN: obj.PN,
    MKSKIPPED: new Map(obj.MKSKIPPED.map(([k, v]: [string, string]) => [k, base64ToBytes(v)]))
  };
}

// Generate initial shared secret (simplified X3DH)
export function generateSharedSecret(): { sharedSecret: Uint8Array; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } } {
  const keyPair = generateKeyPair();
  const sharedSecret = new Uint8Array(32);
  crypto.getRandomValues(sharedSecret);

  return { sharedSecret, keyPair };
}
