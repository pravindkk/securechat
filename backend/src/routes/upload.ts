import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';
import { storageService } from '../services/storageService.js';
import { BadRequestError } from '../middleware/errorHandler.js';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow images and common file types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'video/mp4',
      'video/webm',
      'application/pdf',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

/**
 * POST /api/upload
 * Upload a file directly
 */
router.post(
  '/',
  authMiddleware,
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (!req.file) {
        throw new BadRequestError('No file provided');
      }

      const { buffer, originalname, mimetype } = req.file;
      const folder = req.body.folder || 'messages';

      const result = await storageService.uploadFile(
        buffer,
        originalname,
        mimetype,
        folder
      );

      res.status(201).json({
        success: true,
        data: {
          url: result.url,
          key: result.key,
          size: result.size,
          mimeType: mimetype,
          originalName: originalname,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/upload/base64
 * Upload a base64 encoded file
 */
router.post(
  '/base64',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { data, filename, mimeType, folder = 'messages' } = req.body;

      if (!data || !filename || !mimeType) {
        throw new BadRequestError('Missing required fields: data, filename, mimeType');
      }

      const result = await storageService.uploadBase64(
        data,
        filename,
        mimeType,
        folder
      );

      res.status(201).json({
        success: true,
        data: {
          url: result.url,
          key: result.key,
          size: result.size,
          mimeType,
          originalName: filename,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/upload/presigned
 * Get a presigned URL for direct upload to storage
 */
router.post(
  '/presigned',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { filename, mimeType, folder = 'messages' } = req.body;

      if (!filename || !mimeType) {
        throw new BadRequestError('Missing required fields: filename, mimeType');
      }

      const result = await storageService.getPresignedUploadUrl(
        filename,
        mimeType,
        folder
      );

      res.json({
        success: true,
        data: {
          uploadUrl: result.uploadUrl,
          publicUrl: result.publicUrl,
          key: result.key,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/upload/:key
 * Delete a file
 */
router.delete(
  '/*',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const key = req.params[0]; // Get full path after /api/upload/

      if (!key) {
        throw new BadRequestError('File key is required');
      }

      await storageService.deleteFile(key);

      res.json({
        success: true,
        message: 'File deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
