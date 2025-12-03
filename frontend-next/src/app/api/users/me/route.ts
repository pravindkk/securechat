import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { sanitizeUser } from '@/lib/serverCrypto';

// GET /api/users/me - Get current user
export async function GET(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(sanitizeUser(user));
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Get me error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/users/me - Update current user
export async function PATCH(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const { name, photoUrl } = await request.json();

    const updateData: { name?: string; photoUrl?: string } = {};
    if (name !== undefined) updateData.name = name;
    if (photoUrl !== undefined) updateData.photoUrl = photoUrl;

    const user = await prisma.user.update({
      where: { id: authUser.id },
      data: updateData,
    });

    return NextResponse.json(sanitizeUser(user));
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
