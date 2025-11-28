import { Router, Response } from 'express';
import { authService } from '../services/authService.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  validate,
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
} from '../middleware/validation.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

/**
 * POST /api/auth/request-otp
 * Request OTP for login or registration (unified flow)
 */
router.post(
  '/request-otp',
  validate(requestOtpSchema),
  async (req, res: Response, next) => {
    try {
      const { email } = req.body;
      const result = await authService.requestOtp(email);
      res.json({
        success: true,
        data: {
          isNewUser: result.isNewUser,
          derivationSalt: result.derivationSalt,
        },
        message: 'OTP sent to email (check server logs in development)',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/verify-otp
 * Verify OTP and authenticate (creates account if new user)
 */
router.post(
  '/verify-otp',
  validate(verifyOtpSchema),
  async (req, res: Response, next) => {
    try {
      const { email, otp, name, deviceFingerprint, deviceName, deviceType } = req.body;
      const result = await authService.verifyOtp(
        email,
        otp,
        name,
        deviceFingerprint,
        deviceName || 'Unknown Device',
        deviceType || 'web'
      );
      
      res.json({
        success: true,
        data: {
          user: result.user,
          tokens: result.tokens,
          isNewUser: result.isNewUser,
          encryptedPrivateKey: result.encryptedPrivateKey,
          keyEncryptionSalt: result.keyEncryptionSalt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  validate(refreshTokenSchema),
  async (req, res: Response, next) => {
    try {
      const { refreshToken } = req.body;
      const tokens = await authService.refreshToken(refreshToken);
      res.json({
        success: true,
        data: tokens,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/logout
 * Logout user
 */
router.post(
  '/logout',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { refreshToken } = req.body;
      await authService.logout(req.user!.id, refreshToken);
      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/me
 * Get current user
 */
router.get(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const user = await authService.getCurrentUser(req.user!.id);
      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/keys
 * Get user's encrypted private key (for key recovery on new device)
 */
router.get(
  '/keys',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const keys = await authService.getEncryptedPrivateKey(req.user!.id);
      res.json({
        success: true,
        data: keys,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
