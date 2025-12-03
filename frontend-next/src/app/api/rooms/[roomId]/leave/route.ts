import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { triggerRoomEvent, EVENTS } from '@/lib/pusher';

// POST /api/rooms/[roomId]/leave - Leave a room
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;

    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { members: true },
      });

      if (!room) {
        throw new Error('Room not found');
      }

      if (room.isPrivate) {
        throw new Error('Cannot leave private chats');
      }

      const member = room.members.find((m) => m.userId === user.id);
      if (!member) {
        throw new Error('Not a member of this group');
      }

      // If user is admin, ensure at least one admin remains
      if (member.role === 'admin') {
        const otherAdmins = room.members.filter(
          (m) => m.role === 'admin' && m.userId !== user.id
        );
        if (otherAdmins.length === 0) {
          // Promote another member
          const otherMember = room.members
            .filter((m) => m.userId !== user.id)
            .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
          if (otherMember) {
            await tx.roomMember.update({
              where: { id: otherMember.id },
              data: { role: 'admin' },
            });
          }
        }
      }

      // Remove member
      await tx.roomMember.delete({
        where: { roomId_userId: { roomId, userId: user.id } },
      });

      // Remove user chat entry
      await tx.userChat.deleteMany({
        where: { roomId, userId: user.id },
      });

      // Check if room is now empty
      const remainingCount = await tx.roomMember.count({ where: { roomId } });
      if (remainingCount === 0) {
        await tx.room.delete({ where: { id: roomId } });
        return { roomDeleted: true, newKeyVersion: null };
      }

      // Increment room key version
      const updatedRoom = await tx.room.update({
        where: { id: roomId },
        data: { roomKeyVersion: { increment: 1 } },
      });

      return { roomDeleted: false, newKeyVersion: updatedRoom.roomKeyVersion };
    });

    // Send real-time notification
    if (!result.roomDeleted) {
      try {
        await triggerRoomEvent(roomId, EVENTS.MEMBER_REMOVED, {
          memberId: user.id,
          left: true,
          newKeyVersion: result.newKeyVersion,
        });
      } catch (pusherError) {
        console.error('Pusher error:', pusherError);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (
        error.message.includes('private') ||
        error.message.includes('Not a member')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error('Leave room error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
