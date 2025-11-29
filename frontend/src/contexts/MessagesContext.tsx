/**
 * Messages Context
 *
 * Manages message state, sending, receiving, and typing indicators.
 * Uses the EncryptionContext for cryptographic operations.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { Message, RoomKeyRotatedEvent } from '../types';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { useAuth } from './AuthContext';
import { useRooms } from './RoomsContext';
import { useEncryption } from './EncryptionContext';

interface MessagesContextType {
  messages: Message[];
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  typingUsers: Map<string, Map<string, string>>;
  sendMessage: (
    content: string,
    type?: string,
    mediaUrl?: string,
    mediaType?: string
  ) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  markAsRead: (roomId: string) => void;
  deleteMessage: (roomId: string, messageId: string) => Promise<void>;
}

const MessagesContext = createContext<MessagesContextType | null>(null);

export const useMessages = (): MessagesContextType => {
  const context = useContext(MessagesContext);
  if (!context) {
    throw new Error('useMessages must be used within a MessagesProvider');
  }
  return context;
};

interface MessagesProviderProps {
  children: ReactNode;
}

export const MessagesProvider: React.FC<MessagesProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const { currentRoom, refreshChats, updateCurrentRoomMembers } = useRooms();
  const {
    isRotatingKey,
    setIsRotatingKey,
    encryptMessage,
    decryptMessage,
    decryptMessages,
    clearRoomKey,
  } = useEncryption();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, Map<string, string>>>(new Map());

  const typingTimeouts = useRef<Map<string, Map<string, NodeJS.Timeout>>>(new Map());

  // Load messages when room changes
  useEffect(() => {
    setMessages([]);
    setHasMoreMessages(true);

    if (!currentRoom) return;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      try {
        socketService.joinRoom(currentRoom.id);

        const response = await api.getMessages(currentRoom.id, 50);
        if (response.success && response.data) {
          // Use batch decryption with worker
          const decryptedMessages = await decryptMessages(
            response.data.items,
            currentRoom.id,
            currentRoom.members
          );
          setMessages(decryptedMessages);
          setHasMoreMessages(response.data.hasMore);
        }

        await api.markAsRead(currentRoom.id);
      } catch (error) {
        console.error('[MessagesContext] Failed to load messages:', error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();

    return () => {
      socketService.leaveRoom(currentRoom.id);
    };
  }, [currentRoom, decryptMessages]);

  // Socket event handlers
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Handle new messages
    const unsubMessage = socketService.onMessage(async (message) => {
      // Skip own messages (handled via optimistic update)
      if (message.senderId === user?.id) {
        refreshChats();
        return;
      }

      if (currentRoom && message.roomId === currentRoom.id) {
        const decrypted = await decryptMessage(message, currentRoom.id, currentRoom.members);
        setMessages((prev) => [...prev, decrypted]);
      }
      refreshChats();
    });

    // Handle typing indicators
    const unsubTyping = socketService.onTyping((event) => {
      if (event.userId !== user.id) {
        // Clear existing timeout
        const roomTimeouts = typingTimeouts.current.get(event.roomId);
        if (roomTimeouts?.has(event.userId)) {
          clearTimeout(roomTimeouts.get(event.userId)!);
        }

        // Add typing user
        setTypingUsers((prev) => {
          const newMap = new Map(prev);
          const roomTyping = newMap.get(event.roomId) || new Map<string, string>();
          roomTyping.set(event.userId, event.userName);
          newMap.set(event.roomId, roomTyping);
          return newMap;
        });

        // Set auto-clear timeout
        const timeoutId = setTimeout(() => {
          setTypingUsers((prev) => {
            const newMap = new Map(prev);
            const roomTyping = newMap.get(event.roomId);
            if (roomTyping) {
              roomTyping.delete(event.userId);
              newMap.set(event.roomId, roomTyping);
            }
            return newMap;
          });
          typingTimeouts.current.get(event.roomId)?.delete(event.userId);
        }, 5000);

        if (!typingTimeouts.current.has(event.roomId)) {
          typingTimeouts.current.set(event.roomId, new Map());
        }
        typingTimeouts.current.get(event.roomId)!.set(event.userId, timeoutId);
      }
    });

    // Handle stop typing
    const unsubStopTyping = socketService.onStopTyping((event) => {
      const roomTimeouts = typingTimeouts.current.get(event.roomId);
      if (roomTimeouts?.has(event.userId)) {
        clearTimeout(roomTimeouts.get(event.userId)!);
        roomTimeouts.delete(event.userId);
      }

      setTypingUsers((prev) => {
        const newMap = new Map(prev);
        const roomTyping = newMap.get(event.roomId);
        if (roomTyping) {
          roomTyping.delete(event.userId);
          newMap.set(event.roomId, roomTyping);
        }
        return newMap;
      });
    });

    // Handle key rotation
    const unsubKeyRotated = socketService.onRoomKeyRotated(async (event: RoomKeyRotatedEvent) => {
      setIsRotatingKey(true);
      try {
        clearRoomKey(event.roomId);

        if (currentRoom?.id === event.roomId) {
          // Refresh room to get updated key versions
          const roomResponse = await api.getRoom(event.roomId);
          if (roomResponse.success && roomResponse.data) {
            updateCurrentRoomMembers(roomResponse.data.room.members);

            // Re-decrypt messages with fresh room data
            if (messages.length > 0) {
              const freshMessages = await decryptMessages(
                messages,
                event.roomId,
                roomResponse.data.room.members
              );
              setMessages(freshMessages);
            }
          }
        }
        refreshChats();
      } finally {
        setIsRotatingKey(false);
      }
    });

    // Handle disconnect
    const unsubDisconnect = socketService.onDisconnect(() => {
      setIsRotatingKey(false);
    });

    // Handle reconnect
    const unsubReconnect = socketService.onReconnect(async () => {
      if (currentRoom) {
        try {
          const response = await api.getMessages(currentRoom.id, 50);
          if (response.success && response.data) {
            const decryptedMessages = await decryptMessages(
              response.data.items,
              currentRoom.id,
              currentRoom.members
            );
            setMessages(decryptedMessages);
            setHasMoreMessages(response.data.hasMore);
          }
        } catch (error) {
          console.error('[MessagesContext] Failed to sync after reconnect:', error);
        }
      }
      refreshChats();
    });

    return () => {
      unsubMessage();
      unsubTyping();
      unsubStopTyping();
      unsubKeyRotated();
      unsubDisconnect();
      unsubReconnect();
    };
  }, [
    isAuthenticated,
    user,
    currentRoom,
    messages,
    refreshChats,
    decryptMessage,
    decryptMessages,
    clearRoomKey,
    setIsRotatingKey,
    updateCurrentRoomMembers,
  ]);

  // Send message with optimistic update
  const sendMessage = useCallback(
    async (
      content: string,
      type: string = 'text',
      mediaUrl?: string,
      mediaType?: string
    ) => {
      if (!currentRoom || !user) return;

      if (isRotatingKey) {
        throw new Error('Please wait, security key is being updated');
      }

      // Create optimistic message
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const optimisticMessage: Message = {
        _id: tempId,
        roomId: currentRoom.id,
        senderId: user.id,
        type: type as 'text' | 'image' | 'audio' | 'system',
        encryptedContent: '',
        iv: '',
        authTag: '',
        decryptedContent: content,
        mediaUrl,
        mediaType,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        sender: { id: user.id, name: user.name, photoUrl: user.photoUrl || null },
        pending: true,
      };

      setMessages((prev) => [...prev, optimisticMessage]);

      try {
        const { ciphertext, iv, authTag, keyVersion } = await encryptMessage(
          currentRoom.id,
          currentRoom.members,
          content
        );

        const response = await api.sendMessage(
          currentRoom.id,
          ciphertext,
          iv,
          authTag,
          type,
          mediaUrl,
          mediaType,
          keyVersion
        );

        if (response.success && response.data) {
          // Cache plaintext for own messages
          localStorage.setItem(`msg:${response.data.message._id}`, content);

          // Replace optimistic message
          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === tempId
                ? { ...response.data!.message, decryptedContent: content, pending: false }
                : msg
            )
          );
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === tempId ? { ...msg, pending: false, failed: true } : msg
            )
          );
          throw new Error(response.error || 'Failed to send message');
        }
      } catch (error) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === tempId ? { ...msg, pending: false, failed: true } : msg
          )
        );
        throw error;
      }
    },
    [currentRoom, user, isRotatingKey, encryptMessage]
  );

  // Load more messages (pagination)
  const loadMoreMessages = useCallback(async () => {
    if (!currentRoom || !hasMoreMessages || isLoadingMessages) return;

    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    setIsLoadingMessages(true);
    try {
      const response = await api.getMessages(currentRoom.id, 50, oldestMessage.timestamp);
      if (response.success && response.data) {
        const decryptedMessages = await decryptMessages(
          response.data.items,
          currentRoom.id,
          currentRoom.members
        );
        setMessages((prev) => [...decryptedMessages, ...prev]);
        setHasMoreMessages(response.data.hasMore);
      }
    } catch (error) {
      console.error('[MessagesContext] Failed to load more messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [currentRoom, hasMoreMessages, isLoadingMessages, messages, decryptMessages]);

  // Mark room as read
  const markAsRead = useCallback((roomId: string) => {
    socketService.markRead(roomId);
  }, []);

  // Delete message
  const deleteMessage = useCallback(async (roomId: string, messageId: string) => {
    const response = await api.deleteMessage(roomId, messageId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete message');
    }
    setMessages((prev) => prev.filter((m) => m._id !== messageId));
  }, []);

  return (
    <MessagesContext.Provider
      value={{
        messages,
        isLoadingMessages,
        hasMoreMessages,
        typingUsers,
        sendMessage,
        loadMoreMessages,
        markAsRead,
        deleteMessage,
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
};

export default MessagesProvider;
