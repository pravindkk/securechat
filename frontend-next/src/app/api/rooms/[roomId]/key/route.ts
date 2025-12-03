import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/rooms/[roomId]/key - Get user's room key
export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;

    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
      select: { encryptedRoomKey: true, keyVersion: true },
    });

    if (!member) {
      return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    return NextResponse.json({
      encryptedRoomKey: member.encryptedRoomKey,
      keyVersion: member.keyVersion,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Get room key error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/rooms/[roomId]/key - Rotate room key
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;
    const { encryptedKeys } = await request.json();

    // Verify user is admin
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!member || member.role !== 'admin') {
      return NextResponse.json({ error: 'Admin privileges required' }, { status: 403 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { members: true },
      });

      if (!room) {
        throw new Error('Room not found');
      }

      const currentKeyVersion = room.roomKeyVersion;

      // Update each member's encrypted room key
      for (const roomMember of room.members) {
        const newEncryptedKey = encryptedKeys[roomMember.userId];
        if (!newEncryptedKey) {
          throw new Error(`Missing encrypted key for member ${roomMember.userId}`);
        }

        await tx.roomMember.update({
          where: { id: roomMember.id },
          data: {
            encryptedRoomKey: newEncryptedKey,
            keyVersion: currentKeyVersion,
          },
        });
      }

      return { keyVersion: currentKeyVersion };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Rotate room key error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
