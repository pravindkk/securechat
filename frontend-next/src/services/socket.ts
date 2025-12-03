import { io, Socket } from 'socket.io-client';
import {
  Message,
  TypingEvent,
  PresenceEvent,
  MemberAddedEvent,
  MemberRemovedEvent,
  RoomKeyRotatedEvent,
} from '@/types';

type MessageHandler = (message: Message) => void;
type TypingHandler = (event: TypingEvent) => void;
type PresenceHandler = (event: PresenceEvent) => void;
type ErrorHandler = (error: { message: string }) => void;
type DisconnectHandler = (reason: string) => void;
type ReconnectHandler = () => void;

// Group event handlers
type MemberAddedHandler = (event: MemberAddedEvent) => void;
type MemberRemovedHandler = (event: MemberRemovedEvent) => void;
type RoomKeyRotatedHandler = (event: RoomKeyRotatedEvent) => void;

class SocketService {
  private socket: Socket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private typingHandlers: TypingHandler[] = [];
  private presenceHandlers: PresenceHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];
  private reconnectHandlers: ReconnectHandler[] = [];

  // Group event handler arrays
  private memberAddedHandlers: MemberAddedHandler[] = [];
  private memberRemovedHandlers: MemberRemovedHandler[] = [];
  private roomKeyRotatedHandlers: RoomKeyRotatedHandler[] = [];

  // Track joined rooms for reconnection
  private joinedRooms: Set<string> = new Set();
  private userId: string | null = null;

  async connect(token?: string, userId?: string): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    this.userId = userId || null;

    return new Promise((resolve) => {
      // Connect to the same origin (custom server)
      this.socket = io({
        transports: ['websocket', 'polling'],
        autoConnect: true,
      });

      this.socket.on('connect', () => {
        console.log('[Socket.IO] Connected:', this.socket?.id);

        // Authenticate with userId
        if (this.userId) {
          this.socket?.emit('authenticate', { userId: this.userId });
        }

        // Rejoin all previously joined rooms on reconnect
        if (this.joinedRooms.size > 0) {
          console.log('[Socket.IO] Rejoining rooms:', Array.from(this.joinedRooms));
          this.joinedRooms.forEach((roomId) => {
            this.socket?.emit('join-room', { roomId });
          });
          this.reconnectHandlers.forEach((handler) => handler());
        }
        resolve();
      });

      this.socket.on('connect_error', (error: Error) => {
        console.error('[Socket.IO] Connection error:', error);
        this.errorHandlers.forEach((handler) => handler({ message: error.message }));
      });

      this.socket.on('disconnect', (reason: string) => {
        console.log('[Socket.IO] Disconnected:', reason);
        this.disconnectHandlers.forEach((handler) => handler(reason));
      });

      // Message events
      this.socket.on('new-message', (data: Message) => {
        this.messageHandlers.forEach((handler) => handler(data));
      });

      // Typing events
      this.socket.on('typing', (event: TypingEvent) => {
        this.typingHandlers.forEach((handler) => handler(event));
      });

      // Presence events
      this.socket.on('presence', (event: PresenceEvent) => {
        this.presenceHandlers.forEach((handler) => handler(event));
      });

      // Group events
      this.socket.on('member-added', (event: MemberAddedEvent) => {
        this.memberAddedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('member-removed', (event: MemberRemovedEvent) => {
        this.memberRemovedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('key-rotated', (event: RoomKeyRotatedEvent) => {
        this.roomKeyRotatedHandlers.forEach((handler) => handler(event));
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.joinedRooms.clear();
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  joinRoom(roomId: string): void {
    this.joinedRooms.add(roomId);
    if (this.socket?.connected) {
      this.socket.emit('join-room', { roomId });
    }
  }

  leaveRoom(roomId: string): void {
    this.joinedRooms.delete(roomId);
    if (this.socket?.connected) {
      this.socket.emit('leave-room', { roomId });
    }
  }

  sendTyping(roomId: string): void {
    if (this.socket?.connected && this.userId) {
      this.socket.emit('typing', { roomId, userId: this.userId, isTyping: true });
    }
  }

  sendStopTyping(roomId: string): void {
    if (this.socket?.connected && this.userId) {
      this.socket.emit('typing', { roomId, userId: this.userId, isTyping: false });
    }
  }

  markRead(_roomId: string): void {
    // Mark read is handled via API
  }

  updatePresence(_state: 'online' | 'offline'): void {
    // Presence is handled via API
  }

  // Event handler registration methods
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  onTyping(handler: TypingHandler): () => void {
    this.typingHandlers.push(handler);
    return () => {
      this.typingHandlers = this.typingHandlers.filter((h) => h !== handler);
    };
  }

  onStopTyping(_handler: (event: { roomId: string; userId: string }) => void): () => void {
    // Combined with onTyping
    return () => {};
  }

  onPresenceUpdate(handler: PresenceHandler): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }

  onUnreadCountUpdate(_handler: (event: { roomId: string; unreadCount: number }) => void): () => void {
    // Handled via API polling
    return () => {};
  }

  onMessagesRead(_handler: (event: { roomId: string; userId: string }) => void): () => void {
    // Handled via API polling
    return () => {};
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
    };
  }

  // Group event handler registration methods
  onMemberAdded(handler: MemberAddedHandler): () => void {
    this.memberAddedHandlers.push(handler);
    return () => {
      this.memberAddedHandlers = this.memberAddedHandlers.filter((h) => h !== handler);
    };
  }

  onMemberRemoved(handler: MemberRemovedHandler): () => void {
    this.memberRemovedHandlers.push(handler);
    return () => {
      this.memberRemovedHandlers = this.memberRemovedHandlers.filter((h) => h !== handler);
    };
  }

  onMemberLeft(_handler: (event: { roomId: string; userId: string }) => void): () => void {
    // Combined with onMemberRemoved
    return () => {};
  }

  onRoleChanged(_handler: (event: { roomId: string; userId: string; newRole: string }) => void): () => void {
    // Handled via API polling
    return () => {};
  }

  onRoomKeyRotated(handler: RoomKeyRotatedHandler): () => void {
    this.roomKeyRotatedHandlers.push(handler);
    return () => {
      this.roomKeyRotatedHandlers = this.roomKeyRotatedHandlers.filter((h) => h !== handler);
    };
  }

  onGroupUpdated(_handler: (event: { roomId: string; name?: string; photoUrl?: string }) => void): () => void {
    // Handled via API polling
    return () => {};
  }

  onGroupDeleted(_handler: (event: { roomId: string }) => void): () => void {
    // Handled via API polling
    return () => {};
  }

  onGroupCreated(_handler: (event: { roomId: string }) => void): () => void {
    // Handled via API polling
    return () => {};
  }

  onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.push(handler);
    return () => {
      this.disconnectHandlers = this.disconnectHandlers.filter((h) => h !== handler);
    };
  }

  onReconnect(handler: ReconnectHandler): () => void {
    this.reconnectHandlers.push(handler);
    return () => {
      this.reconnectHandlers = this.reconnectHandlers.filter((h) => h !== handler);
    };
  }
}

export const socketService = new SocketService();
export default socketService;
