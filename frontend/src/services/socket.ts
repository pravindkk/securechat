import { io, Socket } from 'socket.io-client';
import { Message, TypingEvent, PresenceEvent, UnreadCountEvent } from '../types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

type MessageHandler = (message: Message) => void;
type TypingHandler = (event: TypingEvent) => void;
type StopTypingHandler = (event: { roomId: string; userId: string }) => void;
type PresenceHandler = (event: PresenceEvent) => void;
type UnreadCountHandler = (event: UnreadCountEvent) => void;
type MessagesReadHandler = (event: { roomId: string; userId: string }) => void;
type ErrorHandler = (error: { message: string }) => void;

class SocketService {
  private socket: Socket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private typingHandlers: TypingHandler[] = [];
  private stopTypingHandlers: StopTypingHandler[] = [];
  private presenceHandlers: PresenceHandler[] = [];
  private unreadCountHandlers: UnreadCountHandler[] = [];
  private messagesReadHandlers: MessagesReadHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];

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
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
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
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  joinRoom(roomId: string): void {
    this.socket?.emit('join_room', { roomId });
  }

  leaveRoom(roomId: string): void {
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
}

export const socketService = new SocketService();
export default socketService;
