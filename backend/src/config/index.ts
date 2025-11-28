import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isProduction = process.env.NODE_ENV === 'production';

function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Default values that should NEVER be used in production
const INSECURE_DEFAULTS = [
  'dev_jwt_secret_key_change_in_production_32chars',
  'dev_refresh_secret_change_in_production_32',
];

function requireSecureSecret(key: string, defaultValue: string): string {
  const value = process.env[key] || defaultValue;

  // In production, ensure we're not using default/weak secrets
  if (isProduction) {
    if (!process.env[key]) {
      throw new Error(`Production requires explicit ${key} environment variable`);
    }
    if (INSECURE_DEFAULTS.includes(value)) {
      throw new Error(`${key} is using an insecure default value in production`);
    }
    if (value.length < 32) {
      throw new Error(`${key} must be at least 32 characters in production`);
    }
  }

  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5001', 10),
  
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  
  jwt: {
    secret: requireSecureSecret('JWT_SECRET', 'dev_jwt_secret_key_change_in_production_32chars'),
    refreshSecret: requireSecureSecret('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_in_production_32'),
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  
  mongodb: {
    uri: requireEnv('MONGODB_URI', 'mongodb://localhost:27017/chatapp'),
  },
  
  redis: {
    url: requireEnv('REDIS_URL', 'redis://localhost:6379'),
  },
  
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'chatapp',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },
  
  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10),
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
  },
  
  encryption: {
    masterKey: requireEnv('MASTER_ENCRYPTION_KEY'),
  },
};

export default config;
