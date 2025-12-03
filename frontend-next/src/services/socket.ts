import PusherClient from 'pusher-js';
import type { Channel } from 'pusher-js';
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
  private pusher: PusherClient | null = null;
  private channels: Map<string, Channel> = new Map();
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

  async connect(_token?: string): Promise<void> {
    if (this.pusher) {
      return;
    }

    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2';

    if (!key) {
      console.warn('[Pusher] No Pusher key configured, real-time disabled');
      return;
    }

    return new Promise((resolve) => {
      this.pusher = new PusherClient(key, {
        cluster,
      });

      this.pusher.connection.bind('connected', () => {
        console.log('[Pusher] Connected');
        // Rejoin all previously joined rooms on reconnect
        if (this.joinedRooms.size > 0) {
          console.log('[Pusher] Rejoining rooms:', Array.from(this.joinedRooms));
          this.joinedRooms.forEach((roomId) => {
            this.subscribeToRoom(roomId);
          });
          this.reconnectHandlers.forEach((handler) => handler());
        }
        resolve();
      });

      this.pusher.connection.bind('error', (error: Error) => {
        console.error('[Pusher] Connection error:', error);
        this.errorHandlers.forEach((handler) => handler({ message: error.message }));
      });

      this.pusher.connection.bind('disconnected', () => {
        console.log('[Pusher] Disconnected');
        this.disconnectHandlers.forEach((handler) => handler('disconnected'));
      });
    });
  }

  private subscribeToRoom(roomId: string): void {
    if (!this.pusher || this.channels.has(roomId)) {
      return;
    }

    const channelName = `private-room-${roomId}`;
    const channel = this.pusher.subscribe(channelName);

    channel.bind('new-message', (data: Message) => {
      this.messageHandlers.forEach((handler) => handler(data));
    });

    channel.bind('typing', (event: TypingEvent) => {
      this.typingHandlers.forEach((handler) => handler(event));
    });

    channel.bind('member-added', (event: MemberAddedEvent) => {
      this.memberAddedHandlers.forEach((handler) => handler(event));
    });

    channel.bind('member-removed', (event: MemberRemovedEvent) => {
      this.memberRemovedHandlers.forEach((handler) => handler(event));
    });

    channel.bind('key-rotated', (event: RoomKeyRotatedEvent) => {
      this.roomKeyRotatedHandlers.forEach((handler) => handler(event));
    });

    this.channels.set(roomId, channel);
  }

  disconnect(): void {
    if (this.pusher) {
      this.channels.forEach((_, roomId) => {
        this.pusher?.unsubscribe(`private-room-${roomId}`);
      });
      this.channels.clear();
      this.pusher.disconnect();
      this.pusher = null;
    }
    this.joinedRooms.clear();
  }

  isConnected(): boolean {
    return this.pusher?.connection.state === 'connected';
  }

  joinRoom(roomId: string): void {
    this.joinedRooms.add(roomId);
    this.subscribeToRoom(roomId);
  }

  leaveRoom(roomId: string): void {
    this.joinedRooms.delete(roomId);
    if (this.pusher && this.channels.has(roomId)) {
      this.pusher.unsubscribe(`private-room-${roomId}`);
      this.channels.delete(roomId);
    }
  }

  // These methods are no-ops in Pusher - typing is handled via API
  sendTyping(_roomId: string): void {
    // In Pusher, typing would be sent via API and broadcast
  }

  sendStopTyping(_roomId: string): void {
    // In Pusher, stop typing would be sent via API and broadcast
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
    // Combined with onTyping in Pusher
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
