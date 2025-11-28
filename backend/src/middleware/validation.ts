import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
};

// Auth schemas - OTP only (no password)
export const requestOtpSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    otp: z.string().length(6, 'OTP must be 6 digits'),
    name: z.string().min(1).max(100).optional(),
    deviceFingerprint: z.string().min(1, 'Device fingerprint required'),
    deviceName: z.string().min(1).max(100).optional(),
    deviceType: z.enum(['web', 'mobile', 'desktop']).optional(),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token required'),
  }),
});

// Room schemas
export const createRoomSchema = z.object({
  body: z.object({
    memberIds: z.array(z.string().uuid()).min(1, 'At least one member required'),
    name: z.string().min(1).max(100).optional(),
    isPrivate: z.boolean().default(true),
  }),
});

// Message schemas
export const sendMessageSchema = z.object({
  body: z.object({
    encryptedContent: z.string().min(1, 'Encrypted content required'),
    iv: z.string().min(1, 'IV required'),
    authTag: z.string().min(1, 'Auth tag required'),
    type: z.enum(['text', 'image', 'audio', 'system']).default('text'),
    mediaUrl: z.string().url().optional(),
    mediaType: z.string().optional(),
  }),
  params: z.object({
    roomId: z.string().uuid('Invalid room ID'),
  }),
});

export const getMessagesSchema = z.object({
  params: z.object({
    roomId: z.string().uuid('Invalid room ID'),
  }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.string().optional(),
  }),
});

// User schemas
export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    photoUrl: z.string().url().nullable().optional(),
  }),
});
