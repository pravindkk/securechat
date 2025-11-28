/**
 * TLS 1.3 Style Encryption for Secure Chat
 * 
 * Architecture:
 * - Each user has an RSA-OAEP keypair for key exchange
 * - Each room has a symmetric AES-256-GCM key
 * - Room key is encrypted for each member using their RSA public key
 * - Messages are encrypted with the room key using AES-256-GCM
 * - Multi-device support: same user key works on any device
 */

// Convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Convert string to Uint8Array
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Convert Uint8Array to string
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Generate random bytes
export function getRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Derive a key from password using PBKDF2
 * Used to encrypt the user's private key for storage
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: string,
  iterations: number = 100000
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    stringToBytes(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: stringToBytes(salt),
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-256-GCM
 */
export async function aesEncrypt(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const iv = getRandomBytes(12);
  const data = stringToBytes(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // AES-GCM appends auth tag to ciphertext
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertextArray = encryptedArray.slice(0, -16);
  const authTagArray = encryptedArray.slice(-16);

  return {
    ciphertext: arrayBufferToBase64(ciphertextArray.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    authTag: arrayBufferToBase64(authTagArray.buffer),
  };
}

/**
 * Decrypt data with AES-256-GCM
 */
export async function aesDecrypt(
  key: CryptoKey,
  ciphertext: string,
  iv: string,
  authTag: string
): Promise<string> {
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(ciphertext));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(authTag));
  const ivBytes = new Uint8Array(base64ToArrayBuffer(iv));

  // Combine ciphertext and auth tag for WebCrypto
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

/**
 * Import RSA public key from PEM format
 */
export async function importPublicKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and newlines
  const pemContents = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = base64ToArrayBuffer(pemContents);

  return crypto.subtle.importKey(
    'spki',
    binaryDer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt']
  );
}

/**
 * Import RSA private key from PEM format
 */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and newlines
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

/**
 * Decrypt room key using user's RSA private key
 */
export async function decryptRoomKey(
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

/**
 * Decrypt the user's private key using OTP-derived key
 */
export async function decryptPrivateKey(
  encryptedPrivateKeyJson: string,
  otp: string,
  email: string,
  keyEncryptionSalt: string
): Promise<string> {
  // Derive key from OTP + email
  const derivedKey = await deriveKeyFromPassword(otp + email, keyEncryptionSalt);

  // Parse the encrypted private key
  const { encrypted, iv, authTag } = JSON.parse(encryptedPrivateKeyJson);

  // Decrypt
  return aesDecrypt(derivedKey, encrypted, iv, authTag);
}

/**
 * Generate device fingerprint
 */
export function generateDeviceFingerprint(): string {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 'unknown',
  ];

  // Simple hash of components
  let hash = 0;
  const str = components.join('|');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  // Add random component for uniqueness
  const random = getRandomBytes(8);
  const randomHex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${Math.abs(hash).toString(16)}-${randomHex}`;
}

/**
 * Get stored device fingerprint or generate new one
 */
export function getDeviceFingerprint(): string {
  const stored = localStorage.getItem('deviceFingerprint');
  if (stored) return stored;

  const fingerprint = generateDeviceFingerprint();
  localStorage.setItem('deviceFingerprint', fingerprint);
  return fingerprint;
}

/**
 * Get device type
 */
export function getDeviceType(): 'web' | 'mobile' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad|tablet/i.test(ua)) {
    return 'mobile';
  }
  if (/electron/i.test(ua)) {
    return 'desktop';
  }
  return 'web';
}

/**
 * Get device name
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  
  // Try to extract browser and OS
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return `${browser} on ${os}`;
}
