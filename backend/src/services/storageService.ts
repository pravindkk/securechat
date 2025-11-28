import { Client } from 'minio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

class StorageService {
  private client: Client;
  private bucket: string;
  private initialized: boolean = false;

  constructor() {
    this.client = new Client({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
    this.bucket = config.minio.bucket;
  }

  /**
   * Initialize storage - ensure bucket exists
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        logger.info(`Created MinIO bucket: ${this.bucket}`);
        
        // Set bucket policy for public read access to uploaded files
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        };
        await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
      }
      this.initialized = true;
      logger.info(`MinIO storage initialized with bucket: ${this.bucket}`);
    } catch (error) {
      logger.error('Failed to initialize MinIO storage:', error);
      throw error;
    }
  }

  /**
   * Generate a unique filename
   */
  private generateFilename(originalName: string): string {
    const ext = originalName.split('.').pop() || 'bin';
    const hash = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    return `${timestamp}-${hash}.${ext}`;
  }

  /**
   * Upload a file from buffer
   */
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    folder: string = 'uploads'
  ): Promise<{ url: string; key: string; size: number }> {
    await this.initialize();

    const filename = this.generateFilename(originalName);
    const key = `${folder}/${filename}`;
    const size = buffer.length;

    await this.client.putObject(this.bucket, key, buffer, size, {
      'Content-Type': mimeType,
    });

    // Generate URL
    const protocol = config.minio.useSSL ? 'https' : 'http';
    const port = config.minio.port === 80 || config.minio.port === 443 ? '' : `:${config.minio.port}`;
    const url = `${protocol}://${config.minio.endpoint}${port}/${this.bucket}/${key}`;

    logger.info(`Uploaded file: ${key} (${size} bytes)`);

    return { url, key, size };
  }

  /**
   * Upload a base64 encoded file
   */
  async uploadBase64(
    base64Data: string,
    originalName: string,
    mimeType: string,
    folder: string = 'uploads'
  ): Promise<{ url: string; key: string; size: number }> {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Content, 'base64');
    return this.uploadFile(buffer, originalName, mimeType, folder);
  }

  /**
   * Delete a file
   */
  async deleteFile(key: string): Promise<void> {
    await this.initialize();
    await this.client.removeObject(this.bucket, key);
    logger.info(`Deleted file: ${key}`);
  }

  /**
   * Get a presigned URL for direct upload
   */
  async getPresignedUploadUrl(
    originalName: string,
    mimeType: string,
    folder: string = 'uploads',
    expirySeconds: number = 3600
  ): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
    await this.initialize();

    const filename = this.generateFilename(originalName);
    const key = `${folder}/${filename}`;

    const uploadUrl = await this.client.presignedPutObject(
      this.bucket,
      key,
      expirySeconds
    );

    const protocol = config.minio.useSSL ? 'https' : 'http';
    const port = config.minio.port === 80 || config.minio.port === 443 ? '' : `:${config.minio.port}`;
    const publicUrl = `${protocol}://${config.minio.endpoint}${port}/${this.bucket}/${key}`;

    return { uploadUrl, key, publicUrl };
  }

  /**
   * Check if a file exists
   */
  async fileExists(key: string): Promise<boolean> {
    await this.initialize();
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }
}

export const storageService = new StorageService();
export default storageService;
