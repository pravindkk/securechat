import jwt from 'jsonwebtoken';
import { OtpType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import {
  hashString,
  getExpiryDate,
  sanitizeUser,
  generateUserKeyPair,
  deriveKey,
  encryptWithKey,
  decryptWithKey,
  generateSalt,
} from '../utils/helpers.js';
import { otpService } from './otpService.js';
import { UnauthorizedError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { TokenPair, UserPayload } from '../types/index.js';

export class AuthService {
  /**
   * Request OTP for login/registration (unified flow)
   */
  async requestOtp(email: string): Promise<{ isNewUser: boolean; derivationSalt: string }> {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    const type = existingUser ? OtpType.LOGIN : OtpType.REGISTRATION;
    
    await otpService.checkRateLimit(email, type);
    const { derivationSalt } = await otpService.generateOtp(email, type, existingUser?.id);

    return {
      isNewUser: !existingUser,
      derivationSalt,
    };
  }

  /**
   * Verify OTP and authenticate user (creates account if new)
   */
  async verifyOtp(
    email: string,
    otp: string,
    name: string | undefined,
    deviceFingerprint: string,
    deviceName: string = 'Unknown Device',
    deviceType: string = 'web'
  ): Promise<{
    user: ReturnType<typeof sanitizeUser>;
    tokens: TokenPair;
    isNewUser: boolean;
    encryptedPrivateKey: string;
    keyEncryptionSalt: string;
  }> {
    // Try LOGIN first, then REGISTRATION
    let verifyResult = await otpService.verifyOtp(email, otp, OtpType.LOGIN);
    let isNewUser = false;

    if (!verifyResult.isValid) {
      verifyResult = await otpService.verifyOtp(email, otp, OtpType.REGISTRATION);
      isNewUser = true;
    }

    if (!verifyResult.isValid || !verifyResult.derivationSalt) {
      throw new UnauthorizedError('Invalid or expired OTP');
    }

    let user;
    let encryptedPrivateKey: string;
    let keyEncryptionSalt: string;

    if (isNewUser) {
      // Create new user with encryption keys
      const { publicKey, privateKey } = generateUserKeyPair();
      
      // 1. Encrypt private key with master key (server-side storage)
      const masterKey = Buffer.from(config.encryption.masterKey, 'hex');
      const masterEncrypted = encryptWithKey(privateKey, masterKey);
      const masterEncryptedPrivateKey = JSON.stringify(masterEncrypted);
      
      // 2. Encrypt private key with OTP-derived key (for this session)
      keyEncryptionSalt = generateSalt();
      const keyEncryptionKey = deriveKey(otp + email, keyEncryptionSalt);
      const otpEncrypted = encryptWithKey(privateKey, keyEncryptionKey);
      encryptedPrivateKey = JSON.stringify(otpEncrypted);

      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          publicKey,
          encryptedPrivateKey,
          keyEncryptionSalt,
          masterEncryptedPrivateKey,
          state: 'online',
        },
      });

      logger.info(`New user registered: ${email}`);
    } else {
      // Existing user login
      user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      // MULTI-DEVICE LOGIN FLOW:
      // 1. Decrypt private key using master key
      const masterKey = Buffer.from(config.encryption.masterKey, 'hex');
      const masterEncryptedData = JSON.parse(user.masterEncryptedPrivateKey);
      const privateKey = decryptWithKey(
        masterEncryptedData.encrypted,
        masterKey,
        masterEncryptedData.iv,
        masterEncryptedData.authTag
      );
      
      // 2. Re-encrypt with NEW OTP-derived key for this session
      keyEncryptionSalt = generateSalt();
      const keyEncryptionKey = deriveKey(otp + email, keyEncryptionSalt);
      const otpEncrypted = encryptWithKey(privateKey, keyEncryptionKey);
      encryptedPrivateKey = JSON.stringify(otpEncrypted);
      
      // 3. Update the stored OTP-encrypted key and salt
      await prisma.user.update({
        where: { id: user.id },
        data: {
          encryptedPrivateKey,
          keyEncryptionSalt,
          state: 'online',
          lastSeen: new Date(),
        },
      });
    }

    // Register or update device
    await this.registerDevice(user.id, deviceFingerprint, deviceName, deviceType);

    // Generate tokens
    const tokens = await this.generateTokens(user);

    logger.info(`User ${isNewUser ? 'registered and ' : ''}logged in: ${email}`);

    return {
      user: sanitizeUser(user),
      tokens,
      isNewUser,
      encryptedPrivateKey,
      keyEncryptionSalt,
    };
  }

  /**
   * Register or update a device for the user
   */
  private async registerDevice(
    userId: string,
    fingerprint: string,
    deviceName: string,
    deviceType: string
  ): Promise<void> {
    await prisma.device.upsert({
      where: { fingerprint },
      create: {
        userId,
        fingerprint,
        deviceName,
        deviceType,
      },
      update: {
        lastActive: new Date(),
        deviceName,
      },
    });
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<TokenPair> {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as UserPayload & {
        type: string;
      };

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedError('Invalid refresh token');
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
      });

      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      // Verify session exists
      const tokenHash = hashString(refreshToken);
      const session = await prisma.session.findFirst({
        where: {
          userId: user.id,
          tokenHash,
        },
      });

      if (!session) {
        throw new UnauthorizedError('Invalid session');
      }

      // Generate new tokens WITHOUT creating a new session
      const tokens = await this.generateTokens(user, false);

      // Update existing session with new refresh token hash
      await prisma.session.update({
        where: { id: session.id },
        data: {
          tokenHash: hashString(tokens.refreshToken),
          expiresAt: getExpiryDate(7 * 24 * 60),
        },
      });

      return tokens;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid refresh token');
      }
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        state: 'offline',
        lastSeen: new Date(),
      },
    });

    if (refreshToken) {
      const tokenHash = hashString(refreshToken);
      await prisma.session.deleteMany({
        where: { userId, tokenHash },
      });
    } else {
      await prisma.session.deleteMany({
        where: { userId },
      });
    }

    logger.info(`User logged out: ${userId}`);
  }

  /**
   * Get current user
   */
  async getCurrentUser(userId: string): Promise<ReturnType<typeof sanitizeUser>> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return sanitizeUser(user);
  }

  /**
   * Get user's encrypted private key
   */
  async getEncryptedPrivateKey(userId: string): Promise<{ encryptedPrivateKey: string; keyEncryptionSalt: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedPrivateKey: true, keyEncryptionSalt: true },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return {
      encryptedPrivateKey: user.encryptedPrivateKey,
      keyEncryptionSalt: user.keyEncryptionSalt,
    };
  }

  /**
   * Generate access and refresh tokens
   * @param user - User object
   * @param createSession - Whether to create a new session (false during token refresh)
   */
  private async generateTokens(
    user: { id: string; email: string; name: string | null },
    createSession: boolean = true
  ): Promise<TokenPair> {
    const payload: UserPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
    };

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.accessExpiry,
    });

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiry }
    );

    if (createSession) {
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashString(refreshToken),
          expiresAt: getExpiryDate(7 * 24 * 60),
        },
      });
    }

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
export default authService;
