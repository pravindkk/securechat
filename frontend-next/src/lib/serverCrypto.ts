/**
 * Server-side crypto utilities using Node.js crypto module
 */
import crypto from 'crypto';

const PBKDF2_ITERATIONS = 100000;

export function generateOtp(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

export function getExpiryDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function generateSalt(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function deriveKey(
  password: string,
  salt: string,
  keyLength: number = 32
): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, keyLength, 'sha256');
}

export function encryptWithKey(
  data: string,
  key: Buffer
): { encrypted: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptWithKey(
  encrypted: string,
  key: Buffer,
  iv: string,
  authTag: string
): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export function generateUserKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { publicKey, privateKey };
}

export function rsaEncrypt(data: Buffer, publicKeyPem: string): string {
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    data
  );
  return encrypted.toString('base64');
}

export function rsaDecrypt(encryptedData: string, privateKeyPem: string): Buffer {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedData, 'base64')
  );
  return decrypted;
}

export function generateRoomKey(): Buffer {
  return crypto.randomBytes(32);
}

export function sanitizeUser(user: {
  id: string;
  email: string;
  name: string | null;
  photoUrl: string | null;
  state: string;
  lastSeen: Date;
  createdAt: Date;
  publicKey: string;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    photoUrl: user.photoUrl,
    state: user.state,
    lastSeen: user.lastSeen.toISOString(),
    createdAt: user.createdAt.toISOString(),
    publicKey: user.publicKey,
  };
}
