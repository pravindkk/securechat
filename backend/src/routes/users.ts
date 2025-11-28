import { Router, Response } from 'express';
import { userService } from '../services/userService.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, updateUserSchema } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

/**
 * GET /api/users
 * Search/list users
 */
router.get(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { q, limit } = req.query;
      const users = await userService.searchUsers(
        (q as string) || '',
        req.user!.id,
        parseInt(limit as string) || 20
      );
      res.json({
        success: true,
        data: { users },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/users/me/devices
 * Get user's devices - MUST be before /:id route
 */
router.get(
  '/me/devices',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const devices = await userService.getDevices(req.user!.id);
      res.json({
        success: true,
        data: { devices },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/users/me/devices/:deviceId
 * Remove a device - MUST be before /:id route
 */
router.delete(
  '/me/devices/:deviceId',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      await userService.removeDevice(req.user!.id, req.params.deviceId);
      res.json({
        success: true,
        message: 'Device removed',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/users/:id
 * Get user by ID
 */
router.get(
  '/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const user = await userService.getUser(req.params.id);
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
 * PATCH /api/users/:id
 * Update user profile
 */
router.patch(
  '/:id',
  authMiddleware,
  validate(updateUserSchema),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (req.params.id !== req.user!.id) {
        res.status(403).json({ success: false, error: 'Can only update your own profile' });
        return;
      }

      const user = await userService.updateUser(req.user!.id, req.body);
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
 * GET /api/users/:id/public-key
 * Get user's public key
 */
router.get(
  '/:id/public-key',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const publicKey = await userService.getUserPublicKey(req.params.id);
      res.json({
        success: true,
        data: { publicKey },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/users/:id
 * Delete user account
 */
router.delete(
  '/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (req.params.id !== req.user!.id) {
        res.status(403).json({ success: false, error: 'Can only delete your own account' });
        return;
      }

      await userService.deleteUser(req.user!.id);
      res.json({
        success: true,
        message: 'Account deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
