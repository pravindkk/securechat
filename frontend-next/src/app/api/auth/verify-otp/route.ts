import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateTokens } from '@/lib/auth';
import {
  generateUserKeyPair,
  encryptWithKey,
  decryptWithKey,
  deriveKey,
  generateSalt,
  hashString,
  getExpiryDate,
  sanitizeUser,
} from '@/lib/serverCrypto';
const MASTER_KEY = process.env.MASTER_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export async function POST(request: NextRequest) {
  try {
    const { email, otp, name, deviceFingerprint, deviceName, deviceType } = await request.json();

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }

    // Try LOGIN first, then REGISTRATION
    let otpRecord = await prisma.otpCode.findFirst({
      where: {
        email,
        code: otp,
        type: 'LOGIN' as any,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    let isNewUser = false;

    if (!otpRecord) {
      otpRecord = await prisma.otpCode.findFirst({
        where: {
          email,
          code: otp,
          type: 'REGISTRATION' as any,
          used: false,
          expiresAt: { gt: new Date() },
        },
      });
      isNewUser = true;
    }

    if (!otpRecord || !otpRecord.derivationSalt) {
      return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 401 });
    }

    // Mark OTP as used
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true },
    });

    let user;
    let encryptedPrivateKey: string;
    let keyEncryptionSalt: string;
    const masterKey = Buffer.from(MASTER_KEY, 'hex');

    if (isNewUser) {
      // Create new user with encryption keys
      const { publicKey, privateKey } = generateUserKeyPair();

      // Encrypt private key with master key (server-side storage)
      const masterEncrypted = encryptWithKey(privateKey, masterKey);
      const masterEncryptedPrivateKey = JSON.stringify(masterEncrypted);

      // Encrypt private key with OTP-derived key (for this session)
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
    } else {
      // Existing user login
      user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Decrypt private key using master key
      const masterEncryptedData = JSON.parse(user.masterEncryptedPrivateKey);
      const privateKey = decryptWithKey(
        masterEncryptedData.encrypted,
        masterKey,
        masterEncryptedData.iv,
        masterEncryptedData.authTag
      );

      // Re-encrypt with NEW OTP-derived key for this session
      keyEncryptionSalt = generateSalt();
      const keyEncryptionKey = deriveKey(otp + email, keyEncryptionSalt);
      const otpEncrypted = encryptWithKey(privateKey, keyEncryptionKey);
      encryptedPrivateKey = JSON.stringify(otpEncrypted);

      // Update stored key and salt
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
    if (deviceFingerprint) {
      await prisma.device.upsert({
        where: { fingerprint: deviceFingerprint },
        create: {
          userId: user.id,
          fingerprint: deviceFingerprint,
          deviceName: deviceName || 'Unknown Device',
          deviceType: deviceType || 'web',
        },
        update: {
          lastActive: new Date(),
          deviceName: deviceName || 'Unknown Device',
        },
      });
    }

    // Generate tokens
    const tokens = generateTokens(user);

    // Create session
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashString(tokens.refreshToken),
        expiresAt: getExpiryDate(7 * 24 * 60), // 7 days
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        tokens,
        isNewUser,
        encryptedPrivateKey,
        keyEncryptionSalt,
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
