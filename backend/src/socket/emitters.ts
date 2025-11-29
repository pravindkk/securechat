/**
 * Socket Event Emitters
 *
 * Centralized event emitters for broadcasting socket events.
 * Used by services and controllers to notify clients of changes.
 */

import { Server as SocketServer } from 'socket.io';

let ioInstance: SocketServer | null = null;

/**
 * Set the Socket.IO instance (called during initialization)
 */
export const setIO = (io: SocketServer): void => {
  ioInstance = io;
};

/**
 * Get the Socket.IO instance
 */
export const getIO = (): SocketServer => {
  if (!ioInstance) {
    throw new Error('Socket.IO not initialized');
  }
  return ioInstance;
};

// ==========================================
// GROUP EVENT EMITTERS
// ==========================================

export interface GroupEventData {
  roomId: string;
  [key: string]: unknown;
}

/**
 * Emit event when a member is added to a group
 * Also notifies the new member directly since they haven't joined the room channel yet
 */
export const emitMemberAdded = (data: {
  roomId: string;
  member: {
    id: string;
    name: string | null;
    email: string;
    photoUrl: string | null;
    role: string;
    publicKey: string;
    keyVersion: number;
  };
  addedBy: { id: string; name: string };
}) => {
  const io = getIO();
  // Notify existing room members
  io.to(`room:${data.roomId}`).emit('member_added', data);
  // Also notify the new member directly (they haven't joined the room channel yet)
  io.to(`user:${data.member.id}`).emit('member_added', data);
};

/**
 * Emit event when a member is removed from a group
 */
export const emitMemberRemoved = (data: {
  roomId: string;
  memberId: string;
  removedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('member_removed', data);
  // Also notify the removed user directly
  io.to(`user:${data.memberId}`).emit('removed_from_room', {
    roomId: data.roomId,
  });
};

/**
 * Emit event when a member leaves a group
 */
export const emitMemberLeft = (data: {
  roomId: string;
  memberId: string;
  memberName: string;
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('member_left', data);
};

/**
 * Emit event when a member's role changes
 */
export const emitRoleChanged = (data: {
  roomId: string;
  memberId: string;
  newRole: 'admin' | 'member';
  changedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('role_changed', data);
};

/**
 * Emit event when room key is rotated
 * Sends each member their own encrypted key
 */
export const emitRoomKeyRotated = (data: {
  roomId: string;
  newKeyVersion: number;
  encryptedKeys: Record<string, string>; // userId -> encryptedKey
}) => {
  const io = getIO();
  // Send each user their specific encrypted key
  for (const [userId, encryptedKey] of Object.entries(data.encryptedKeys)) {
    io.to(`user:${userId}`).emit('room_key_rotated', {
      roomId: data.roomId,
      newKeyVersion: data.newKeyVersion,
      encryptedKey,
    });
  }
};

/**
 * Emit event when group details are updated
 */
export const emitGroupUpdated = (data: {
  roomId: string;
  changes: { name?: string; photoUrl?: string | null };
  updatedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('group_updated', data);
};

/**
 * Emit event when a group is deleted
 */
export const emitGroupDeleted = (data: {
  roomId: string;
  deletedBy: { id: string; name: string };
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('group_deleted', data);
};

/**
 * Emit event when a group is created
 * Notifies each member directly since they haven't joined the room channel yet
 */
export const emitGroupCreated = (data: {
  roomId: string;
  room: {
    id: string;
    name: string;
    members: Array<{ id: string; name: string | null; email: string }>;
  };
  createdBy: { id: string; name: string };
}) => {
  const io = getIO();
  // Notify each member directly since they haven't joined the room channel yet
  for (const member of data.room.members) {
    io.to(`user:${member.id}`).emit('group_created', data);
  }
};

// ==========================================
// MESSAGE EVENT EMITTERS
// ==========================================

/**
 * Emit new message to room
 */
export const emitNewMessage = (roomId: string, message: unknown) => {
  const io = getIO();
  io.to(`room:${roomId}`).emit('new_message', message);
};

/**
 * Emit message deleted event
 */
export const emitMessageDeleted = (data: {
  roomId: string;
  messageId: string;
  deletedBy: string;
}) => {
  const io = getIO();
  io.to(`room:${data.roomId}`).emit('message_deleted', data);
};

// ==========================================
// PRESENCE EVENT EMITTERS
// ==========================================

/**
 * Emit presence update to all clients
 */
export const emitPresenceUpdate = (data: {
  userId: string;
  state: 'online' | 'offline';
  lastSeen: string;
}) => {
  const io = getIO();
  io.emit('presence_update', data);
};
