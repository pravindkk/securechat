import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5001', 10),
  
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  
  jwt: {
    secret: requireEnv('JWT_SECRET', 'dev_jwt_secret_key_change_in_production_32chars'),
    refreshSecret: requireEnv('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_in_production_32'),
    accessExpiry: '15m',
    refreshExpiry: '7d',
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
    masterKey: process.env.MASTER_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
};

export default config;
