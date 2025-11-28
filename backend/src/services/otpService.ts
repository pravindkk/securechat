import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { generateOtp, getExpiryDate, generateSalt } from '../utils/helpers.js';
import { TooManyRequestsError } from '../middleware/errorHandler.js';
import { OtpType } from '@prisma/client';

const OTP_RATE_LIMIT = 5; // Max OTPs per 10 minutes
const OTP_RATE_WINDOW = 10 * 60 * 1000; // 10 minutes

// Rate limiting for OTP verification attempts (prevents brute force)
const OTP_VERIFY_LOCKOUT_ATTEMPTS = 10; // After this many failed attempts, lockout
const OTP_VERIFY_LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minute lockout

// In-memory store for verification attempts (should use Redis in production)
const verificationAttempts = new Map<string, { count: number; lastAttempt: number }>();

export class OtpService {
  async checkRateLimit(email: string, type: OtpType): Promise<void> {
    const windowStart = new Date(Date.now() - OTP_RATE_WINDOW);
    
    const recentOtps = await prisma.otpCode.count({
      where: {
        email,
        type,
        createdAt: { gte: windowStart },
      },
    });

    if (recentOtps >= OTP_RATE_LIMIT) {
      throw new TooManyRequestsError('Too many OTP requests. Please try again later.');
    }
  }

  /**
   * FIX-12: Use transaction to prevent race condition between invalidation and creation
   */
  async generateOtp(email: string, type: OtpType, userId?: string): Promise<{ otp: string; derivationSalt: string }> {
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
   * Check rate limit for OTP verification attempts (prevents brute force)
   */
  private checkVerificationRateLimit(email: string): void {
    const key = `verify:${email}`;
    const now = Date.now();
    const attempts = verificationAttempts.get(key);

    if (attempts) {
      // Check if user is in lockout period
      if (
        attempts.count >= OTP_VERIFY_LOCKOUT_ATTEMPTS &&
        now - attempts.lastAttempt < OTP_VERIFY_LOCKOUT_DURATION
      ) {
        const remainingMinutes = Math.ceil(
          (OTP_VERIFY_LOCKOUT_DURATION - (now - attempts.lastAttempt)) / 60000
        );
        throw new TooManyRequestsError(
          `Too many failed verification attempts. Please try again in ${remainingMinutes} minutes.`
        );
      }

      // Reset if lockout duration has passed
      if (now - attempts.lastAttempt >= OTP_VERIFY_LOCKOUT_DURATION) {
        verificationAttempts.delete(key);
      }
    }
  }

  /**
   * Record a failed verification attempt
   */
  private recordFailedVerification(email: string): void {
    const key = `verify:${email}`;
    const now = Date.now();
    const attempts = verificationAttempts.get(key);

    if (attempts) {
      attempts.count += 1;
      attempts.lastAttempt = now;
    } else {
      verificationAttempts.set(key, { count: 1, lastAttempt: now });
    }
  }

  /**
   * Clear verification attempts on successful verification
   */
  private clearVerificationAttempts(email: string): void {
    verificationAttempts.delete(`verify:${email}`);
  }

  async verifyOtp(email: string, otp: string, type: OtpType): Promise<{ isValid: boolean; derivationSalt: string | null; userId: string | null }> {
    // Check verification rate limit before attempting
    this.checkVerificationRateLimit(email);

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
      // Record failed attempt
      this.recordFailedVerification(email);
      logger.warn(`Failed OTP verification attempt for ${email}`);
      return { isValid: false, derivationSalt: null, userId: null };
    }

    // Clear failed attempts on success
    this.clearVerificationAttempts(email);

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
