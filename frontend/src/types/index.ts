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
}

export interface Room {
  id: string;
  name: string | null;
  isPrivate: boolean;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  members: RoomMember[];
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
  timestamp: string;
  createdAt: string;
  sender?: {
    id: string;
    name: string | null;
    photoUrl?: string | null;
  };
  // Decrypted content (client-side only)
  decryptedContent?: string;
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

// Device types
export interface Device {
  id: string;
  deviceName: string;
  deviceType: string;
  fingerprint: string;
  lastActive: string;
  createdAt: string;
}
