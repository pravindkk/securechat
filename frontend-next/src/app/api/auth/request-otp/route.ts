import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateOtp, getExpiryDate, generateSalt } from '@/lib/serverCrypto';

const OTP_RATE_LIMIT = 5;
const OTP_RATE_WINDOW = 10 * 60 * 1000; // 10 minutes
const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    const type = existingUser ? 'LOGIN' : 'REGISTRATION';

    // Rate limiting
    const windowStart = new Date(Date.now() - OTP_RATE_WINDOW);
    const recentOtps = await prisma.otpCode.count({
      where: {
        email,
        type: type as any,
        createdAt: { gte: windowStart },
      },
    });

    if (recentOtps >= OTP_RATE_LIMIT) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Generate OTP
    const otp = generateOtp(OTP_LENGTH);
    const derivationSalt = generateSalt();

    // Invalidate existing OTPs and create new one in transaction
    await prisma.$transaction(async (tx) => {
      await tx.otpCode.updateMany({
        where: {
          email,
          type: type as any,
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
          type: type as any,
          userId: existingUser?.id,
          derivationSalt,
          expiresAt: getExpiryDate(OTP_EXPIRY_MINUTES),
        },
      });
    });

    // In development, log the OTP
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔐 OTP for ${email} (${type}): ${otp}`);
    }

    // TODO: In production, send OTP via email service

    return NextResponse.json({
      success: true,
      isNewUser: !existingUser,
      derivationSalt,
    });
  } catch (error) {
    console.error('Request OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
