import { NextRequest, NextResponse } from 'next/server';
import { prisma, connectMongoDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import Message from '@/lib/models/Message';
import { triggerRoomEvent, EVENTS } from '@/lib/pusher';

// DELETE /api/rooms/[roomId]/messages/[messageId] - Delete message
export async function DELETE(
  request: NextRequest,
  { params }: { params: { roomId: string; messageId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId, messageId } = params;

    await connectMongoDB();

    const message = await Message.findById(messageId);

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.roomId !== roomId) {
      return NextResponse.json(
        { error: 'Message does not belong to this room' },
        { status: 403 }
      );
    }

    // Check if user is the sender
    if (message.senderId === user.id) {
      await Message.findByIdAndDelete(messageId);
    } else {
      // Check if user is admin of the room
      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: user.id } },
      });

      if (!member || member.role !== 'admin') {
        return NextResponse.json(
          { error: 'Can only delete your own messages' },
          { status: 403 }
        );
      }

      await Message.findByIdAndDelete(messageId);
    }

    // Send real-time notification
    try {
      await triggerRoomEvent(roomId, EVENTS.MESSAGE_DELETED, { messageId });
    } catch (pusherError) {
      console.error('Pusher error:', pusherError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Delete message error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
