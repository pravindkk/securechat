import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { hashString } from '@/lib/serverCrypto';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { refreshToken } = await request.json();

    // Update user state
    await prisma.user.update({
      where: { id: user.id },
      data: {
        state: 'offline',
        lastSeen: new Date(),
      },
    });

    // Delete session
    if (refreshToken) {
      const tokenHash = hashString(refreshToken);
      await prisma.session.deleteMany({
        where: { userId: user.id, tokenHash },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
