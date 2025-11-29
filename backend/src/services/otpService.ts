/**
 * OTP Service
 *
 * Handles OTP generation and verification with Redis-based rate limiting.
 */

import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { generateOtp, getExpiryDate, generateSalt } from '../utils/helpers.js';
import { OtpType } from '@prisma/client';
import { rateLimitService } from './rateLimitService.js';

// Rate limiting configuration
const OTP_RATE_LIMIT = 5; // Max OTPs per 10 minutes
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Brute force protection configuration
const OTP_VERIFY_LOCKOUT_ATTEMPTS = 10; // After this many failed attempts, lockout
const OTP_VERIFY_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minute lockout

export class OtpService {
  /**
   * Check rate limit for OTP generation using Redis
   */
  async checkRateLimit(email: string, type: OtpType): Promise<void> {
    await rateLimitService.enforceLimit(
      `otp:${type}:${email}`,
      OTP_RATE_LIMIT,
      OTP_RATE_WINDOW_MS,
      'Too many OTP requests.'
    );
  }

  /**
   * Generate OTP with transaction for atomicity
   */
  async generateOtp(
    email: string,
    type: OtpType,
    userId?: string
  ): Promise<{ otp: string; derivationSalt: string }> {
    const otp = generateOtp(config.otp.length);
    const derivationSalt = generateSalt();

    // Use transaction to ensure atomicity of invalidation and creation
    await prisma.$transaction(async (tx) => {
      // Invalidate any existing OTPs
      await tx.otpCode.updateMany({
        where: {
          email,
          type,
          used: false,
        },
        data: {
          used: true,
        },
      });

      await tx.otpCode.create({
        data: {
          email,
          code: otp,
          type,
          userId,
          derivationSalt,
          expiresAt: getExpiryDate(config.otp.expiryMinutes),
        },
      });
    });

    // In development, log the OTP (in production, this would send an email)
    logger.info(`🔐 OTP for ${email} (${type}): ${otp}`);

    return { otp, derivationSalt };
  }

  /**
   * Check rate limit for OTP verification attempts using Redis
   * Prevents brute force attacks
   */
  private async checkVerificationRateLimit(email: string): Promise<void> {
    await rateLimitService.enforceLockout(
      `verify:${email}`,
      OTP_VERIFY_LOCKOUT_ATTEMPTS,
      OTP_VERIFY_LOCKOUT_DURATION_MS,
      'Too many failed verification attempts.'
    );
  }

  /**
   * Record a failed verification attempt in Redis
   */
  private async recordFailedVerification(email: string): Promise<void> {
    await rateLimitService.recordFailedAttempt(
      `verify:${email}`,
      OTP_VERIFY_LOCKOUT_ATTEMPTS,
      OTP_VERIFY_LOCKOUT_DURATION_MS
    );
  }

  /**
   * Clear verification attempts on successful verification
   */
  private async clearVerificationAttempts(email: string): Promise<void> {
    await rateLimitService.clearAttempts(`verify:${email}`);
  }

  /**
   * Verify OTP with brute force protection
   */
  async verifyOtp(
    email: string,
    otp: string,
    type: OtpType
  ): Promise<{
    isValid: boolean;
    derivationSalt: string | null;
    userId: string | null;
  }> {
    // Check verification rate limit before attempting
    await this.checkVerificationRateLimit(email);

    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        email,
        code: otp,
        type,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      // Record failed attempt in Redis
      await this.recordFailedVerification(email);
      logger.warn(`Failed OTP verification attempt for ${email}`);
      return { isValid: false, derivationSalt: null, userId: null };
    }

    // Clear failed attempts on success
    await this.clearVerificationAttempts(email);

    // Mark as used
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true },
    });

    return {
      isValid: true,
      derivationSalt: otpRecord.derivationSalt,
      userId: otpRecord.userId,
    };
  }
}

export const otpService = new OtpService();
export default otpService;
