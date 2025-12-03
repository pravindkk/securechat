import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// POST /api/rooms/[roomId]/read - Mark room as read
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;

    await prisma.userChat.updateMany({
      where: { roomId, userId: user.id },
      data: { unreadCount: 0 },
    });

    await prisma.roomMember.updateMany({
      where: { roomId, userId: user.id },
      data: {
        unreadCount: 0,
        lastReadAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Mark as read error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
