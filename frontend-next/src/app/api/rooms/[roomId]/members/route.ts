import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { triggerRoomEvent, EVENTS } from '@/lib/pusher';

// GET /api/rooms/[roomId]/members - Get room members
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

    const members = await prisma.roomMember.findMany({
      where: { roomId },
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
    });

    return NextResponse.json(
      members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        photoUrl: m.user.photoUrl,
        state: m.user.state,
        role: m.role,
        publicKey: m.user.publicKey,
        joinedAt: m.joinedAt.toISOString(),
        addedBy: m.addedBy,
      }))
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Get members error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/rooms/[roomId]/members - Add member
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;
    const { userId: newMemberId, encryptedRoomKey, historicalKeys } = await request.json();

    // Verify requester is admin
    const requesterMember = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!requesterMember || requesterMember.role !== 'admin') {
      return NextResponse.json({ error: 'Admin privileges required' }, { status: 403 });
    }

    // Verify new user exists
    const newUser = await prisma.user.findUnique({
      where: { id: newMemberId },
      select: { id: true, name: true, email: true, photoUrl: true, state: true, publicKey: true },
    });

    if (!newUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: {
          members: true,
          keyHistory: { include: { memberKeys: true } },
        },
      });

      if (!room) {
        throw new Error('Room not found');
      }

      if (room.isPrivate) {
        throw new Error('Cannot add members to private chats');
      }

      if (room.members.length >= room.maxMembers) {
        throw new Error(`Group cannot exceed ${room.maxMembers} members`);
      }

      // Check if already member
      if (room.members.some((m) => m.userId === newMemberId)) {
        throw new Error('User is already a member');
      }

      // Add member
      await tx.roomMember.create({
        data: {
          roomId,
          userId: newMemberId,
          role: 'member',
          encryptedRoomKey,
          keyVersion: room.roomKeyVersion,
          addedBy: user.id,
        },
      });

      // Store historical keys
      if (historicalKeys && historicalKeys.length > 0) {
        for (const histKey of historicalKeys) {
          const keyHistory = room.keyHistory.find((kh) => kh.version === histKey.version);
          if (keyHistory) {
            await tx.roomMemberKeyHistory.create({
              data: {
                roomKeyHistoryId: keyHistory.id,
                userId: newMemberId,
                encryptedRoomKey: histKey.encryptedKey,
              },
            });
          }
        }
      }

      // Create user chat entry
      await tx.userChat.create({
        data: {
          userId: newMemberId,
          roomId,
          otherUserId: null,
        },
      });
    });

    // Send real-time notification
    try {
      await triggerRoomEvent(roomId, EVENTS.MEMBER_ADDED, {
        member: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          photoUrl: newUser.photoUrl,
          state: newUser.state,
          role: 'member',
          publicKey: newUser.publicKey,
        },
        addedBy: user.id,
      });
    } catch (pusherError) {
      console.error('Pusher error:', pusherError);
    }

    return NextResponse.json({
      member: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        photoUrl: newUser.photoUrl,
        state: newUser.state,
        role: 'member',
        publicKey: newUser.publicKey,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (
        error.message.includes('Admin') ||
        error.message.includes('private') ||
        error.message.includes('exceed') ||
        error.message.includes('already')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error('Add member error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
