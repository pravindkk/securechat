import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { Chat, Room, Message, RoomMember } from '../types';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { keyManager } from '../crypto/keyManager';
import { useAuth } from './AuthContext';

interface ChatContextType {
  chats: Chat[];
  currentRoom: Room | null;
  messages: Message[];
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  typingUsers: Map<string, Map<string, string>>; // roomId -> Map<userId, userName>
  setCurrentRoom: (room: Room | null) => void;
  sendMessage: (content: string, type?: string, mediaUrl?: string, mediaType?: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  markAsRead: (roomId: string) => void;
  createRoom: (isPrivate: boolean, memberIds: string[], name?: string) => Promise<Room>;
  refreshChats: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

interface ChatProviderProps {
  children: ReactNode;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  // Track typing users: roomId -> Map<userId, userName>
  const [typingUsers, setTypingUsers] = useState<Map<string, Map<string, string>>>(new Map());

  // Cache for encrypted room keys
  const roomKeysCache = useRef<Map<string, string>>(new Map());

  // Get encrypted room key for current user
  const getEncryptedRoomKey = useCallback(async (roomId: string, members: RoomMember[]): Promise<string> => {
    // Check if keyManager is initialized
    if (!keyManager.isInitialized()) {
      throw new Error('Encryption keys not initialized. Please log out and log in again.');
    }

    // Check cache first
    if (roomKeysCache.current.has(roomId)) {
      return roomKeysCache.current.get(roomId)!;
    }

    // Find current user's encrypted room key from room members
    const currentMember = members.find((m) => m.id === user?.id);
    if (currentMember?.encryptedRoomKey) {
      roomKeysCache.current.set(roomId, currentMember.encryptedRoomKey);
      return currentMember.encryptedRoomKey;
    }

    // Fallback: fetch from API
    const response = await api.getRoomKey(roomId);
    if (response.success && response.data) {
      roomKeysCache.current.set(roomId, response.data.encryptedRoomKey);
      return response.data.encryptedRoomKey;
    }

    throw new Error('Failed to get room key');
  }, [user]);

  // Decrypt a message
  const decryptMessage = useCallback(async (
    message: Message,
    roomId: string,
    members: RoomMember[]
  ): Promise<Message> => {
    try {
      // Own messages - check local cache first
      if (message.senderId === user?.id) {
        const cachedContent = localStorage.getItem(`msg:${message._id}`);
        if (cachedContent) {
          return { ...message, decryptedContent: cachedContent };
        }
      }

      const encryptedRoomKey = await getEncryptedRoomKey(roomId, members);
      const decryptedContent = await keyManager.decryptMessage(
        roomId,
        encryptedRoomKey,
        message.encryptedContent,
        message.iv,
        message.authTag
      );
      return { ...message, decryptedContent };
    } catch (error) {
      console.error('Failed to decrypt message:', error);
      return { ...message, decryptedContent: '[Decryption failed]' };
    }
  }, [user, getEncryptedRoomKey]);

  // Load chats
  const refreshChats = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoadingChats(true);
    try {
      const response = await api.getChats();
      if (response.success && response.data) {
        setChats(response.data.chats);
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
    } finally {
      setIsLoadingChats(false);
    }
  }, [isAuthenticated]);

  // Initial chat load
  useEffect(() => {
    if (isAuthenticated) {
      refreshChats();
    }
  }, [isAuthenticated, refreshChats]);

  // Socket event handlers
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const unsubMessage = socketService.onMessage(async (message) => {
      if (currentRoom && message.roomId === currentRoom.id) {
        const decrypted = await decryptMessage(message, currentRoom.id, currentRoom.members);
        setMessages((prev) => [...prev, decrypted]);
      }
      refreshChats();
    });

    const unsubTyping = socketService.onTyping((event) => {
      if (event.userId !== user.id) {
        setTypingUsers((prev) => {
          const newMap = new Map(prev);
          const roomTyping = newMap.get(event.roomId) || new Map<string, string>();
          roomTyping.set(event.userId, event.userName);
          newMap.set(event.roomId, roomTyping);
          return newMap;
        });
      }
    });

    const unsubStopTyping = socketService.onStopTyping((event) => {
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

    const unsubUnreadCount = socketService.onUnreadCountUpdate((event) => {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === event.roomId ? { ...chat, unreadCount: event.count } : chat
        )
      );
    });

    const unsubPresence = socketService.onPresenceUpdate((event) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.otherUser?.id === event.userId) {
            return {
              ...chat,
              otherUser: { ...chat.otherUser, state: event.state },
            };
          }
          return chat;
        })
      );
    });

    return () => {
      unsubMessage();
      unsubTyping();
      unsubStopTyping();
      unsubUnreadCount();
      unsubPresence();
    };
  }, [isAuthenticated, user, currentRoom, decryptMessage, refreshChats]);

  // Load messages when room changes
  useEffect(() => {
    if (!currentRoom) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      try {
        socketService.joinRoom(currentRoom.id);

        const response = await api.getMessages(currentRoom.id, 50);
        if (response.success && response.data) {
          const decryptedMessages = await Promise.all(
            response.data.items.map((msg) =>
              decryptMessage(msg, currentRoom.id, currentRoom.members)
            )
          );
          setMessages(decryptedMessages);
          setHasMoreMessages(response.data.hasMore);
        }

        await api.markAsRead(currentRoom.id);
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === currentRoom.id ? { ...chat, unreadCount: 0 } : chat
          )
        );
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();

    return () => {
      socketService.leaveRoom(currentRoom.id);
    };
  }, [currentRoom, decryptMessage]);

  // Send message
  const sendMessage = useCallback(async (
    content: string,
    type: string = 'text',
    mediaUrl?: string,
    mediaType?: string
  ) => {
    if (!currentRoom || !user) return;

    try {
      const encryptedRoomKey = await getEncryptedRoomKey(currentRoom.id, currentRoom.members);
      const { ciphertext, iv, authTag } = await keyManager.encryptMessage(
        currentRoom.id,
        encryptedRoomKey,
        content
      );

      const response = await api.sendMessage(
        currentRoom.id,
        ciphertext,
        iv,
        authTag,
        type,
        mediaUrl,
        mediaType
      );

      if (response.success && response.data) {
        // Cache the plaintext for own messages
        localStorage.setItem(`msg:${response.data.message._id}`, content);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  }, [currentRoom, user, getEncryptedRoomKey]);

  // Load more messages
  const loadMoreMessages = useCallback(async () => {
    if (!currentRoom || !hasMoreMessages || isLoadingMessages) return;

    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    setIsLoadingMessages(true);
    try {
      const response = await api.getMessages(currentRoom.id, 50, oldestMessage.timestamp);
      if (response.success && response.data) {
        const decryptedMessages = await Promise.all(
          response.data.items.map((msg) =>
            decryptMessage(msg, currentRoom.id, currentRoom.members)
          )
        );
        setMessages((prev) => [...decryptedMessages, ...prev]);
        setHasMoreMessages(response.data.hasMore);
      }
    } catch (error) {
      console.error('Failed to load more messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [currentRoom, hasMoreMessages, isLoadingMessages, messages, decryptMessage]);

  // Mark as read
  const markAsRead = useCallback((roomId: string) => {
    socketService.markRead(roomId);
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === roomId ? { ...chat, unreadCount: 0 } : chat
      )
    );
  }, []);

  // Create room
  const createRoom = useCallback(async (
    isPrivate: boolean,
    memberIds: string[],
    name?: string
  ): Promise<Room> => {
    const response = await api.createRoom(memberIds, name, isPrivate);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to create room');
    }
    await refreshChats();
    return response.data.room;
  }, [refreshChats]);

  return (
    <ChatContext.Provider
      value={{
        chats,
        currentRoom,
        messages,
        isLoadingChats,
        isLoadingMessages,
        hasMoreMessages,
        typingUsers,
        setCurrentRoom,
        sendMessage,
        loadMoreMessages,
        markAsRead,
        createRoom,
        refreshChats,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export default ChatProvider;
