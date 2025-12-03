/**
 * Server-side socket emit helper
 * Uses global.emitToRoom from custom server.js when available
 */

// Declare global types for TypeScript
declare global {
  // eslint-disable-next-line no-var
  var emitToRoom: ((roomId: string, event: string, data: unknown) => void) | undefined;
  // eslint-disable-next-line no-var
  var emitToUser: ((userId: string, event: string, data: unknown) => void) | undefined;
}

/**
 * Emit an event to all clients in a room
 */
export function emitToRoom(roomId: string, event: string, data: unknown): void {
  if (typeof global.emitToRoom === 'function') {
    global.emitToRoom(roomId, event, data);
  } else {
    console.warn('[Socket] emitToRoom not available - running without custom server?');
  }
}

/**
 * Emit an event to a specific user
 */
export function emitToUser(userId: string, event: string, data: unknown): void {
  if (typeof global.emitToUser === 'function') {
    global.emitToUser(userId, event, data);
  } else {
    console.warn('[Socket] emitToUser not available - running without custom server?');
  }
}

// Event names
export const SOCKET_EVENTS = {
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
