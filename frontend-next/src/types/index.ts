// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  photoUrl?: string | null;
  state: string;
  lastSeen: string;
  createdAt: string;
  publicKey: string;
}

// Auth types
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthState {
  user: User | null;
  tokens: TokenPair | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Room types
export interface RoomMember {
  id: string;
  name: string | null;
  email: string;
  photoUrl?: string | null;
  state: string;
  role: string;
  publicKey: string;
  encryptedRoomKey?: string;
  keyVersion?: number;
}

export interface Room {
  id: string;
  name: string | null;
  isPrivate: boolean;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  members: RoomMember[];
  roomKeyVersion?: number;
  maxMembers?: number;
}

export interface Chat {
  id: string;
  name: string | null;
  isPrivate: boolean;
  photoUrl: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  otherUser: RoomMember | null;
  members: RoomMember[];
}

// Message types
export type SystemEventType =
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'admin_promoted'
  | 'admin_demoted'
  | 'group_created'
  | 'group_name_changed'
  | 'group_photo_changed';

export interface SystemEventData {
  actorId: string;
  actorName: string;
  targetId?: string;
  targetName?: string;
  oldValue?: string;
  newValue?: string;
}

export interface Message {
  _id: string;
  roomId: string;
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'system';
  encryptedContent: string;
  iv: string;
  authTag: string;
  mediaUrl?: string;
  mediaType?: string;
  keyVersion?: number;
  systemEventType?: SystemEventType;
  systemEventData?: SystemEventData;
  timestamp: string;
  createdAt: string;
  sender?: {
    id: string;
    name: string | null;
    photoUrl?: string | null;
  };
  // Decrypted content (client-side only)
  decryptedContent?: string;
  // Optimistic update flags (client-side only)
  pending?: boolean;
  failed?: boolean;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// Socket Event types
export interface TypingEvent {
  roomId: string;
  userId: string;
  userName: string;
}

export interface PresenceEvent {
  userId: string;
  state: 'online' | 'offline';
  lastSeen: string;
}

export interface NewMessageEvent {
  message: Message;
}

export interface UnreadCountEvent {
  roomId: string;
  count: number;
}

// Group socket event types
export interface MemberAddedEvent {
  roomId: string;
  member: RoomMember;
  addedBy: { id: string; name: string };
}

export interface MemberRemovedEvent {
  roomId: string;
  memberId: string;
  removedBy: { id: string; name: string };
}

export interface MemberLeftEvent {
  roomId: string;
  memberId: string;
  memberName: string;
}

export interface RoleChangedEvent {
  roomId: string;
  memberId: string;
  newRole: 'admin' | 'member';
  changedBy: { id: string; name: string };
}

export interface RoomKeyRotatedEvent {
  roomId: string;
  newKeyVersion: number;
  encryptedKey: string;
}

export interface GroupUpdatedEvent {
  roomId: string;
  changes: { name?: string; photoUrl?: string | null };
  updatedBy: { id: string; name: string };
}

export interface GroupDeletedEvent {
  roomId: string;
  deletedBy: { id: string; name: string };
}

export interface GroupCreatedEvent {
  roomId: string;
  room: {
    id: string;
    name: string;
    members: Array<{ id: string; name: string | null; email: string }>;
  };
  createdBy: { id: string; name: string };
}

// Device types
export interface Device {
  id: string;
  deviceName: string;
  deviceType: string;
  fingerprint: string;
  lastActive: string;
  createdAt: string;
}

// IndexedDB stored key types
export interface StoredKeyData {
  id: string;
  userId: string;
  encryptedPrivateKey: ArrayBuffer;
  iv: Uint8Array;
  salt: Uint8Array;
  createdAt: number;
  lastAccessed: number;
}

export interface StoredRoomKey {
  id: string; // roomId or roomId:version
  encryptedKey: string;
  version: number;
  cachedAt: number;
}
