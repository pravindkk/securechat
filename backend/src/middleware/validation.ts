import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// Custom URL validator that only allows http:// and https:// schemes
// Prevents XSS attacks via javascript:, data:, or other dangerous schemes
const safeUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'URL must use http:// or https:// protocol' }
);

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

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token required for logout'),
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
    mediaUrl: safeUrlSchema.optional(),
    mediaType: z.string().optional(),
    keyVersion: z.number().int().positive().optional(),
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
    photoUrl: safeUrlSchema.nullable().optional(),
  }),
});

// Group chat schemas
export const createGroupRoomSchema = z.object({
  body: z.object({
    memberIds: z.array(z.string().uuid()).min(1, 'At least one member required').max(29, 'Maximum 29 additional members'),
    name: z.string().min(1, 'Group name required').max(100, 'Group name too long'),
  }),
});

export const addMemberSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid room ID'),
  }),
  body: z.object({
    userId: z.string().uuid('Invalid user ID'),
    encryptedRoomKey: z.string().min(1, 'Encrypted room key required'),
    historicalKeys: z.array(z.object({
      version: z.number().int().positive(),
      encryptedKey: z.string().min(1),
    })).optional(),
  }),
});

export const removeMemberSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid room ID'),
    userId: z.string().uuid('Invalid user ID'),
  }),
});

export const memberActionSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid room ID'),
    userId: z.string().uuid('Invalid user ID'),
  }),
});

export const updateGroupSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid room ID'),
  }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    photoUrl: safeUrlSchema.nullable().optional(),
  }),
});

export const rotateKeySchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid room ID'),
  }),
  body: z.object({
    encryptedKeys: z.record(z.string().uuid(), z.string().min(1)),
  }),
});

export const getRoomKeyVersionSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid room ID'),
    version: z.coerce.number().int().positive('Invalid key version'),
  }),
});
