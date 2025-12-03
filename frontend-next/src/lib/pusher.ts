/**
 * Pusher utilities for real-time communication (Vercel-compatible)
 */
import Pusher from 'pusher';
import PusherClient from 'pusher-js';

// Server-side Pusher instance
let pusherServer: Pusher | null = null;

export function getPusherServer(): Pusher {
  if (!pusherServer) {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2';

    if (!appId || !key || !secret) {
      throw new Error('Pusher server configuration missing');
    }

    pusherServer = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });
  }
  return pusherServer;
}

// Client-side Pusher instance
let pusherClient: PusherClient | null = null;

export function getPusherClient(): PusherClient {
  if (typeof window === 'undefined') {
    throw new Error('getPusherClient can only be called on the client');
  }

  if (!pusherClient) {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2';

    if (!key) {
      throw new Error('Pusher client configuration missing');
    }

    pusherClient = new PusherClient(key, {
      cluster,
    });
  }
  return pusherClient;
}

// Channel naming conventions
export const CHANNELS = {
  room: (roomId: string) => `private-room-${roomId}`,
  user: (userId: string) => `private-user-${userId}`,
  presence: (roomId: string) => `presence-room-${roomId}`,
};

// Event types
export const EVENTS = {
  NEW_MESSAGE: 'new-message',
  MESSAGE_DELETED: 'message-deleted',
  TYPING: 'typing',
  ROOM_UPDATED: 'room-updated',
  MEMBER_ADDED: 'member-added',
  MEMBER_REMOVED: 'member-removed',
  KEY_ROTATED: 'key-rotated',
  USER_ONLINE: 'user-online',
  USER_OFFLINE: 'user-offline',
};

// Helper to send events
export async function triggerEvent(
  channel: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const pusher = getPusherServer();
  await pusher.trigger(channel, event, data);
}

// Helper to send room events
export async function triggerRoomEvent(
  roomId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  await triggerEvent(CHANNELS.room(roomId), event, data);
}

// Helper to send user-specific events
export async function triggerUserEvent(
  userId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  await triggerEvent(CHANNELS.user(userId), event, data);
}
