import { io, Socket } from 'socket.io-client';
import {
  Message,
  TypingEvent,
  PresenceEvent,
  UnreadCountEvent,
  MemberAddedEvent,
  MemberRemovedEvent,
  MemberLeftEvent,
  RoleChangedEvent,
  RoomKeyRotatedEvent,
  GroupUpdatedEvent,
  GroupDeletedEvent,
  GroupCreatedEvent,
} from '@/types';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5001';

type MessageHandler = (message: Message) => void;
type TypingHandler = (event: TypingEvent) => void;
type StopTypingHandler = (event: { roomId: string; userId: string }) => void;
type PresenceHandler = (event: PresenceEvent) => void;
type UnreadCountHandler = (event: UnreadCountEvent) => void;
type MessagesReadHandler = (event: { roomId: string; userId: string }) => void;
type ErrorHandler = (error: { message: string }) => void;
type DisconnectHandler = (reason: string) => void;
type ReconnectHandler = () => void;

// Group event handlers
type MemberAddedHandler = (event: MemberAddedEvent) => void;
type MemberRemovedHandler = (event: MemberRemovedEvent) => void;
type MemberLeftHandler = (event: MemberLeftEvent) => void;
type RoleChangedHandler = (event: RoleChangedEvent) => void;
type RoomKeyRotatedHandler = (event: RoomKeyRotatedEvent) => void;
type GroupUpdatedHandler = (event: GroupUpdatedEvent) => void;
type GroupDeletedHandler = (event: GroupDeletedEvent) => void;
type GroupCreatedHandler = (event: GroupCreatedEvent) => void;

class SocketService {
  private socket: Socket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private typingHandlers: TypingHandler[] = [];
  private stopTypingHandlers: StopTypingHandler[] = [];
  private presenceHandlers: PresenceHandler[] = [];
  private unreadCountHandlers: UnreadCountHandler[] = [];
  private messagesReadHandlers: MessagesReadHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];
  private reconnectHandlers: ReconnectHandler[] = [];

  // Group event handler arrays
  private memberAddedHandlers: MemberAddedHandler[] = [];
  private memberRemovedHandlers: MemberRemovedHandler[] = [];
  private memberLeftHandlers: MemberLeftHandler[] = [];
  private roleChangedHandlers: RoleChangedHandler[] = [];
  private roomKeyRotatedHandlers: RoomKeyRotatedHandler[] = [];
  private groupUpdatedHandlers: GroupUpdatedHandler[] = [];
  private groupDeletedHandlers: GroupDeletedHandler[] = [];
  private groupCreatedHandlers: GroupCreatedHandler[] = [];

  // Track joined rooms for reconnection
  private joinedRooms: Set<string> = new Set();

  async connect(token: string): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      this.socket.on('connect', () => {
        console.log('[Socket] Connected');
        // Rejoin all previously joined rooms on reconnect
        if (this.joinedRooms.size > 0) {
          console.log('[Socket] Rejoining rooms:', Array.from(this.joinedRooms));
          this.joinedRooms.forEach((roomId) => {
            this.socket?.emit('join_room', { roomId });
          });
          // Notify reconnect handlers (for message sync)
          this.reconnectHandlers.forEach((handler) => handler());
        }
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
        // Notify disconnect handlers
        this.disconnectHandlers.forEach((handler) => handler(reason));
      });

      this.socket.on('new_message', (data: { message: Message }) => {
        this.messageHandlers.forEach((handler) => handler(data.message));
      });

      this.socket.on('user_typing', (event: TypingEvent) => {
        this.typingHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('user_stop_typing', (event: { roomId: string; userId: string }) => {
        this.stopTypingHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('presence_update', (event: PresenceEvent) => {
        this.presenceHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('unread_count_update', (event: UnreadCountEvent) => {
        this.unreadCountHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('messages_read', (event: { roomId: string; userId: string }) => {
        this.messagesReadHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('error', (error: { message: string }) => {
        this.errorHandlers.forEach((handler) => handler(error));
      });

      // Group event listeners
      this.socket.on('member_added', (event: MemberAddedEvent) => {
        this.memberAddedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('member_removed', (event: MemberRemovedEvent) => {
        this.memberRemovedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('member_left', (event: MemberLeftEvent) => {
        this.memberLeftHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('role_changed', (event: RoleChangedEvent) => {
        this.roleChangedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('room_key_rotated', (event: RoomKeyRotatedEvent) => {
        this.roomKeyRotatedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('group_updated', (event: GroupUpdatedEvent) => {
        this.groupUpdatedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('group_deleted', (event: GroupDeletedEvent) => {
        this.groupDeletedHandlers.forEach((handler) => handler(event));
      });

      this.socket.on('group_created', (event: GroupCreatedEvent) => {
        this.groupCreatedHandlers.forEach((handler) => handler(event));
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    // Clear joined rooms on disconnect
    this.joinedRooms.clear();
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  joinRoom(roomId: string): void {
    this.joinedRooms.add(roomId);
    this.socket?.emit('join_room', { roomId });
  }

  leaveRoom(roomId: string): void {
    this.joinedRooms.delete(roomId);
    this.socket?.emit('leave_room', { roomId });
  }

  sendTyping(roomId: string): void {
    this.socket?.emit('typing', { roomId });
  }

  sendStopTyping(roomId: string): void {
    this.socket?.emit('stop_typing', { roomId });
  }

  markRead(roomId: string): void {
    this.socket?.emit('mark_read', { roomId });
  }

  updatePresence(state: 'online' | 'offline'): void {
    this.socket?.emit('update_presence', { state });
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

  onStopTyping(handler: StopTypingHandler): () => void {
    this.stopTypingHandlers.push(handler);
    return () => {
      this.stopTypingHandlers = this.stopTypingHandlers.filter((h) => h !== handler);
    };
  }

  onPresenceUpdate(handler: PresenceHandler): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }

  onUnreadCountUpdate(handler: UnreadCountHandler): () => void {
    this.unreadCountHandlers.push(handler);
    return () => {
      this.unreadCountHandlers = this.unreadCountHandlers.filter((h) => h !== handler);
    };
  }

  onMessagesRead(handler: MessagesReadHandler): () => void {
    this.messagesReadHandlers.push(handler);
    return () => {
      this.messagesReadHandlers = this.messagesReadHandlers.filter((h) => h !== handler);
    };
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

  onMemberLeft(handler: MemberLeftHandler): () => void {
    this.memberLeftHandlers.push(handler);
    return () => {
      this.memberLeftHandlers = this.memberLeftHandlers.filter((h) => h !== handler);
    };
  }

  onRoleChanged(handler: RoleChangedHandler): () => void {
    this.roleChangedHandlers.push(handler);
    return () => {
      this.roleChangedHandlers = this.roleChangedHandlers.filter((h) => h !== handler);
    };
  }

  onRoomKeyRotated(handler: RoomKeyRotatedHandler): () => void {
    this.roomKeyRotatedHandlers.push(handler);
    return () => {
      this.roomKeyRotatedHandlers = this.roomKeyRotatedHandlers.filter((h) => h !== handler);
    };
  }

  onGroupUpdated(handler: GroupUpdatedHandler): () => void {
    this.groupUpdatedHandlers.push(handler);
    return () => {
      this.groupUpdatedHandlers = this.groupUpdatedHandlers.filter((h) => h !== handler);
    };
  }

  onGroupDeleted(handler: GroupDeletedHandler): () => void {
    this.groupDeletedHandlers.push(handler);
    return () => {
      this.groupDeletedHandlers = this.groupDeletedHandlers.filter((h) => h !== handler);
    };
  }

  onGroupCreated(handler: GroupCreatedHandler): () => void {
    this.groupCreatedHandlers.push(handler);
    return () => {
      this.groupCreatedHandlers = this.groupCreatedHandlers.filter((h) => h !== handler);
    };
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
