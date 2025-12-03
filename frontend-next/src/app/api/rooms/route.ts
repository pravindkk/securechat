import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { rsaEncrypt, generateRoomKey } from '@/lib/serverCrypto';

// GET /api/rooms - Get user's chats
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const userChats = await prisma.userChat.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        room: {
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
        },
      },
    });

    const chats = userChats.map((chat) => ({
      id: chat.room.id,
      name: chat.room.name,
      isPrivate: chat.room.isPrivate,
      photoUrl: chat.room.photoUrl,
      lastMessagePreview: chat.lastMessagePreview,
      lastMessageAt: chat.lastMessageAt?.toISOString() || null,
      unreadCount: chat.unreadCount,
      otherUser: chat.room.isPrivate
        ? chat.room.members.find((m) => m.userId !== user.id)?.user || null
        : null,
      members: chat.room.members.map((m) => ({
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
    }));

    return NextResponse.json(chats);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Get rooms error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/rooms - Create a new room
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { memberIds, name, isPrivate = true } = await request.json();

    const allMemberIds = [...new Set([user.id, ...memberIds])];

    if (isPrivate && allMemberIds.length !== 2) {
      return NextResponse.json(
        { error: 'Private rooms must have exactly 2 members' },
        { status: 400 }
      );
    }

    // For private chats, check if room already exists
    if (isPrivate) {
      const existingRooms = await prisma.room.findMany({
        where: {
          isPrivate: true,
          AND: [
            { members: { some: { userId: allMemberIds[0] } } },
            { members: { some: { userId: allMemberIds[1] } } },
          ],
        },
        include: {
          _count: { select: { members: true } },
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

      const existingRoom = existingRooms.find((r) => r._count.members === 2);
      if (existingRoom) {
        return NextResponse.json(formatRoomResponse(existingRoom));
      }
    }

    // Generate room key
    const roomKey = generateRoomKey();

    // Get public keys for all members
    const members = await prisma.user.findMany({
      where: { id: { in: allMemberIds } },
      select: { id: true, publicKey: true },
    });

    const publicKeys = new Map<string, string>(
      members.map((m) => [m.id, m.publicKey as string])
    );

    // Create room with members
    const room = await prisma.$transaction(async (tx) => {
      const newRoom = await tx.room.create({
        data: {
          name: isPrivate ? null : name,
          isPrivate,
          createdBy: user.id,
          members: {
            create: allMemberIds.map((userId) => {
              const publicKey = publicKeys.get(userId);
              if (!publicKey) {
                throw new Error(`Public key not found for user ${userId}`);
              }
              const encryptedRoomKey = rsaEncrypt(roomKey, publicKey as string);
              return {
                userId,
                role: userId === user.id ? 'admin' : 'member',
                encryptedRoomKey,
              };
            }),
          },
        },
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

      // Create user chat entries
      for (const memberId of allMemberIds) {
        const otherMember = isPrivate
          ? allMemberIds.find((id) => id !== memberId)
          : null;

        await tx.userChat.create({
          data: {
            userId: memberId,
            roomId: newRoom.id,
            otherUserId: otherMember,
          },
        });
      }

      return newRoom;
    });

    return NextResponse.json(formatRoomResponse(room));
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Create room error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function formatRoomResponse(room: any) {
  return {
    id: room.id,
    name: room.name,
    isPrivate: room.isPrivate,
    photoUrl: room.photoUrl,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    members: room.members.map((m: any) => ({
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
  };
}
