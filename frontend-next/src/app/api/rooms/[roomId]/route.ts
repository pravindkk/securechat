import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/rooms/[roomId] - Get room details
export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;

    // Verify user is member
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!member) {
      return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                photoUrl: true,
                state: true,
                publicKey: true,
              },
            },
          },
        },
      },
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: room.id,
      name: room.name,
      isPrivate: room.isPrivate,
      photoUrl: room.photoUrl,
      roomKeyVersion: room.roomKeyVersion,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      members: room.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        photoUrl: m.user.photoUrl,
        state: m.user.state,
        role: m.role,
        publicKey: m.user.publicKey,
        encryptedRoomKey: m.encryptedRoomKey,
        keyVersion: m.keyVersion,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Get room error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/rooms/[roomId] - Delete room
export async function DELETE(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    if (room.createdBy !== user.id) {
      return NextResponse.json(
        { error: 'Only room creator can delete the room' },
        { status: 403 }
      );
    }

    await prisma.room.delete({
      where: { id: roomId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Delete room error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
