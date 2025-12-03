import { NextRequest, NextResponse } from 'next/server';
import { prisma, connectMongoDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import Message from '@/lib/models/Message';
import { emitToRoom, SOCKET_EVENTS } from '@/lib/socketEmit';

// GET /api/rooms/[roomId]/messages - Get messages
export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const before = searchParams.get('before');

    // Verify user is member
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!member) {
      return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    await connectMongoDB();

    const query: Record<string, unknown> = { roomId };
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, -1) : messages;

    // Get sender info
    const senderIds = [...new Set(items.map((m) => m.senderId))];
    const senders = await prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, photoUrl: true },
    });

    const senderMap = new Map(senders.map((s) => [s.id, s]));

    const messagesWithSender = items.map((m) => ({
      ...m,
      _id: m._id.toString(),
      sender: senderMap.get(m.senderId) || null,
    }));

    return NextResponse.json({
      items: messagesWithSender.reverse(),
      total: items.length,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Get messages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/rooms/[roomId]/messages - Send message
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const user = await requireAuth(request);
    const { roomId } = params;
    const { encryptedContent, iv, authTag, type = 'text', mediaUrl, mediaType } = await request.json();

    // Verify user is member
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });

    if (!member) {
      return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    await connectMongoDB();

    // Get current room key version
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { roomKeyVersion: true },
    });

    // Create message
    const message = await Message.create({
      roomId,
      senderId: user.id,
      type,
      encryptedContent,
      iv,
      authTag,
      mediaUrl,
      mediaType,
      keyVersion: room?.roomKeyVersion || 1,
      timestamp: new Date(),
    });

    // Update last message preview
    const preview = getMessagePreview(type);
    await prisma.userChat.updateMany({
      where: { roomId },
      data: {
        lastMessagePreview: preview,
        lastMessageAt: new Date(),
      },
    });

    // Increment unread count for other members
    await prisma.userChat.updateMany({
      where: {
        roomId,
        userId: { not: user.id },
      },
      data: {
        unreadCount: { increment: 1 },
      },
    });

    await prisma.roomMember.updateMany({
      where: {
        roomId,
        userId: { not: user.id },
      },
      data: {
        unreadCount: { increment: 1 },
      },
    });

    // Get sender info
    const sender = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, photoUrl: true },
    });

    const messageResponse = {
      ...message.toObject(),
      _id: message._id.toString(),
      sender,
    };

    // Send real-time notification via Socket.IO
    try {
      emitToRoom(roomId, SOCKET_EVENTS.NEW_MESSAGE, messageResponse);
    } catch (socketError) {
      console.error('Socket emit error:', socketError);
      // Don't fail the request if socket emit fails
    }

    return NextResponse.json(messageResponse);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Send message error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getMessagePreview(type: string): string {
  switch (type) {
    case 'image':
      return '📷 Image';
    case 'audio':
      return '🎵 Audio';
    case 'system':
      return 'System message';
    default:
      return '[Encrypted message]';
  }
}
