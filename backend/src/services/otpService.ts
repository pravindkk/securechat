import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { generateOtp, getExpiryDate, generateSalt } from '../utils/helpers.js';
import { TooManyRequestsError, BadRequestError } from '../middleware/errorHandler.js';
import { OtpType } from '@prisma/client';

const OTP_RATE_LIMIT = 5; // Max OTPs per 10 minutes
const OTP_RATE_WINDOW = 10 * 60 * 1000; // 10 minutes

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

  async generateOtp(email: string, type: OtpType, userId?: string): Promise<{ otp: string; derivationSalt: string }> {
    // Invalidate any existing OTPs
    await prisma.otpCode.updateMany({
      where: {
        email,
        type,
        used: false,
      },
      data: {
        used: true,
      },
    });

    const otp = generateOtp(config.otp.length);
    const derivationSalt = generateSalt();

    await prisma.otpCode.create({
      data: {
        email,
        code: otp,
        type,
        userId,
        derivationSalt,
        expiresAt: getExpiryDate(config.otp.expiryMinutes),
      },
    });

    // In development, log the OTP (in production, this would send an email)
    logger.info(`🔐 OTP for ${email} (${type}): ${otp}`);

    return { otp, derivationSalt };
  }

  async verifyOtp(email: string, otp: string, type: OtpType): Promise<{ isValid: boolean; derivationSalt: string | null; userId: string | null }> {
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
      return { isValid: false, derivationSalt: null, userId: null };
    }

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
