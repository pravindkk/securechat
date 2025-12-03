import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyRefreshToken, generateTokens } from '@/lib/auth';
import { hashString, getExpiryDate } from '@/lib/serverCrypto';

export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return NextResponse.json({ error: 'Refresh token required' }, { status: 400 });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
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
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } });
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    // Generate new tokens
    const tokens = generateTokens(user);

    // Update session with new refresh token hash
    await prisma.session.update({
      where: { id: session.id },
      data: {
        tokenHash: hashString(tokens.refreshToken),
        expiresAt: getExpiryDate(7 * 24 * 60),
      },
    });

    return NextResponse.json(tokens);
  } catch (error) {
    console.error('Refresh token error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
