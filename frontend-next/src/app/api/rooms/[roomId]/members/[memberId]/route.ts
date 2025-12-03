import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { triggerRoomEvent, EVENTS } from '@/lib/pusher';

// DELETE /api/rooms/[roomId]/members/[memberId] - Remove member
export async function DELETE(
  request: NextRequest,
  { params }: { params: { roomId: string; memberId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId, memberId } = params;

    // Verify requester is admin
    const requesterMember = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!requesterMember || requesterMember.role !== 'admin') {
      return NextResponse.json({ error: 'Admin privileges required' }, { status: 403 });
    }

    if (user.id === memberId) {
      return NextResponse.json(
        { error: 'Use leave endpoint to leave the group' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { members: true },
      });

      if (!room) {
        throw new Error('Room not found');
      }

      if (room.isPrivate) {
        throw new Error('Cannot remove members from private chats');
      }

      const targetMember = room.members.find((m) => m.userId === memberId);
      if (!targetMember) {
        throw new Error('User is not a member of this group');
      }

      // Check if removing last admin
      if (targetMember.role === 'admin') {
        const adminCount = room.members.filter((m) => m.role === 'admin').length;
        if (adminCount === 1) {
          throw new Error('Cannot remove the last admin');
        }
      }

      // Remove member
      await tx.roomMember.delete({
        where: { roomId_userId: { roomId, userId: memberId } },
      });

      // Remove user chat entry
      await tx.userChat.deleteMany({
        where: { roomId, userId: memberId },
      });

      // Clean up historical keys
      await tx.roomMemberKeyHistory.deleteMany({
        where: {
          roomKeyHistory: { roomId },
          userId: memberId,
        },
      });

      // Increment room key version
      const updatedRoom = await tx.room.update({
        where: { id: roomId },
        data: { roomKeyVersion: { increment: 1 } },
      });

      return { newKeyVersion: updatedRoom.roomKeyVersion };
    });

    // Send real-time notification
    try {
      await triggerRoomEvent(roomId, EVENTS.MEMBER_REMOVED, {
        memberId,
        removedBy: user.id,
        newKeyVersion: result.newKeyVersion,
      });
    } catch (pusherError) {
      console.error('Pusher error:', pusherError);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (
        error.message.includes('Admin') ||
        error.message.includes('private') ||
        error.message.includes('last admin') ||
        error.message.includes('not a member')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error('Remove member error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/rooms/[roomId]/members/[memberId] - Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: { roomId: string; memberId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId, memberId } = params;
    const { role } = await request.json();

    // Verify requester is admin
    const requesterMember = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!requesterMember || requesterMember.role !== 'admin') {
      return NextResponse.json({ error: 'Admin privileges required' }, { status: 403 });
    }

    if (role === 'admin') {
      // Promote to admin
      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: memberId } },
      });

      if (!member) {
        return NextResponse.json({ error: 'User is not a member' }, { status: 404 });
      }

      if (member.role === 'admin') {
        return NextResponse.json({ error: 'User is already an admin' }, { status: 400 });
      }

      await prisma.roomMember.update({
        where: { id: member.id },
        data: { role: 'admin' },
      });
    } else if (role === 'member') {
      // Demote to member
      if (user.id === memberId) {
        return NextResponse.json({ error: 'Cannot demote yourself' }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        const room = await tx.room.findUnique({
          where: { id: roomId },
          include: { members: true },
        });

        if (!room) {
          throw new Error('Room not found');
        }

        const targetMember = room.members.find((m) => m.userId === memberId);
        if (!targetMember) {
          throw new Error('User is not a member');
        }

        if (targetMember.role !== 'admin') {
          throw new Error('User is not an admin');
        }

        const adminCount = room.members.filter((m) => m.role === 'admin').length;
        if (adminCount <= 1) {
          throw new Error('Cannot demote the last admin');
        }

        await tx.roomMember.update({
          where: { id: targetMember.id },
          data: { role: 'member' },
        });
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Update member role error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
