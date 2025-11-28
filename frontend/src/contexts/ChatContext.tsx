import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import {
  Chat,
  Room,
  Message,
  RoomMember,
  MemberAddedEvent,
  MemberRemovedEvent,
  MemberLeftEvent,
  RoleChangedEvent,
  GroupUpdatedEvent,
  GroupDeletedEvent,
  RoomKeyRotatedEvent,
} from '../types';
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
  // Group functions
  createGroupRoom: (memberIds: string[], name: string) => Promise<Room>;
  addMember: (roomId: string, userId: string) => Promise<void>;
  removeMember: (roomId: string, userId: string) => Promise<void>;
  leaveRoom: (roomId: string) => Promise<void>;
  promoteMember: (roomId: string, userId: string) => Promise<void>;
  demoteMember: (roomId: string, userId: string) => Promise<void>;
  updateGroup: (roomId: string, data: { name?: string; photoUrl?: string | null }) => Promise<void>;
  deleteGroup: (roomId: string) => Promise<void>;
  deleteMessage: (roomId: string, messageId: string) => Promise<void>;
  isGroupChat: (chat: Chat) => boolean;
  getUserRole: (roomId: string) => 'admin' | 'member' | null;
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
  // Track if key rotation is in progress (to prevent sending messages during rotation)
  const [isRotatingKey, setIsRotatingKey] = useState(false);
  // Track typing timeouts: roomId -> Map<userId, timeoutId>
  const typingTimeouts = useRef<Map<string, Map<string, NodeJS.Timeout>>>(new Map());

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

  // Decrypt a message (with version-aware key handling)
  const decryptMessage = useCallback(async (
    message: Message,
    roomId: string,
    members: RoomMember[]
  ): Promise<Message> => {
    try {
      // System messages don't need decryption
      if (message.type === 'system') {
        return { ...message, decryptedContent: message.encryptedContent || '' };
      }

      // Own messages - check local cache first
      if (message.senderId === user?.id) {
        const cachedContent = localStorage.getItem(`msg:${message._id}`);
        if (cachedContent) {
          return { ...message, decryptedContent: cachedContent };
        }
      }

      // Get current member's key version
      const currentMember = members.find((m) => m.id === user?.id);
      const currentKeyVersion = currentMember?.keyVersion || 1;

      let encryptedRoomKey: string;

      // Check if message was encrypted with a different key version
      if (message.keyVersion && message.keyVersion !== currentKeyVersion) {
        // Fetch historical key from backend
        const keyResponse = await api.getRoomKeyVersion(roomId, message.keyVersion);
        if (keyResponse.success && keyResponse.data) {
          encryptedRoomKey = keyResponse.data.encryptedRoomKey;
          // Decrypt using the versioned key
          const decryptedContent = await keyManager.decryptMessageWithVersion(
            roomId,
            message.keyVersion,
            encryptedRoomKey,
            message.encryptedContent,
            message.iv,
            message.authTag
          );
          return { ...message, decryptedContent };
        } else {
          console.error('Failed to fetch historical key version', message.keyVersion);
          return { ...message, decryptedContent: '[Key version unavailable]' };
        }
      }

      // Use current key
      encryptedRoomKey = await getEncryptedRoomKey(roomId, members);
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
    } else {
      // FIX-4: Clear room key cache when logged out
      roomKeysCache.current.clear();
      setChats([]);
      setMessages([]);
      setCurrentRoom(null);
    }
  }, [isAuthenticated, refreshChats]);

  // Socket event handlers
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const unsubMessage = socketService.onMessage(async (message) => {
      // FIX-2: Skip own messages - sender already handles via optimistic update + API response
      // This prevents race condition where socket echo arrives before/during state update
      if (message.senderId === user?.id) {
        refreshChats();  // Still refresh sidebar for latest message preview
        return;
      }

      if (currentRoom && message.roomId === currentRoom.id) {
        const decrypted = await decryptMessage(message, currentRoom.id, currentRoom.members);
        setMessages((prev) => [...prev, decrypted]);
      }
      refreshChats();
    });

    const unsubTyping = socketService.onTyping((event) => {
      if (event.userId !== user.id) {
        // Clear existing timeout for this user in this room
        const roomTimeouts = typingTimeouts.current.get(event.roomId);
        if (roomTimeouts?.has(event.userId)) {
          clearTimeout(roomTimeouts.get(event.userId)!);
        }

        // Add user to typing list
        setTypingUsers((prev) => {
          const newMap = new Map(prev);
          const roomTyping = newMap.get(event.roomId) || new Map<string, string>();
          roomTyping.set(event.userId, event.userName);
          newMap.set(event.roomId, roomTyping);
          return newMap;
        });

        // Set timeout to auto-clear typing indicator after 5 seconds
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
          // Clean up timeout reference
          const timeouts = typingTimeouts.current.get(event.roomId);
          if (timeouts) {
            timeouts.delete(event.userId);
          }
        }, 5000);

        // Store timeout reference
        if (!typingTimeouts.current.has(event.roomId)) {
          typingTimeouts.current.set(event.roomId, new Map());
        }
        typingTimeouts.current.get(event.roomId)!.set(event.userId, timeoutId);
      }
    });

    const unsubStopTyping = socketService.onStopTyping((event) => {
      // Clear timeout for this user
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

    // Group event handlers
    const unsubMemberAdded = socketService.onMemberAdded((event: MemberAddedEvent) => {
      // Refresh chats to get updated member list
      refreshChats();
      // If this is the current room, update it
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev
            ? {
                ...prev,
                members: [...prev.members, event.member],
              }
            : null
        );
      }
    });

    const unsubMemberRemoved = socketService.onMemberRemoved(async (event: MemberRemovedEvent) => {
      // If current user was removed, clear the room
      if (event.memberId === user?.id) {
        if (currentRoom?.id === event.roomId) {
          setCurrentRoom(null);
        }
        keyManager.clearAllRoomKeys(event.roomId);
        roomKeysCache.current.delete(event.roomId);
      } else {
        // Someone else was removed - CRITICAL: fetch fresh room data to get updated keyVersions
        // This prevents decryption failures from stale keyVersion values
        keyManager.clearRoomKey(event.roomId);
        roomKeysCache.current.delete(event.roomId);

        if (currentRoom?.id === event.roomId) {
          // Set rotating flag to prevent message sending during update
          setIsRotatingKey(true);
          try {
            // CRITICAL: Fetch fresh room data to get updated keyVersions for all members
            const roomResponse = await api.getRoom(event.roomId);
            if (roomResponse.success && roomResponse.data) {
              setCurrentRoom((prev) =>
                prev ? { ...prev, members: roomResponse.data!.room.members } : null
              );

              // Re-decrypt existing messages with fresh member data
              if (messages.length > 0) {
                const freshMessages = await Promise.all(
                  messages.map((msg) => decryptMessage(msg, event.roomId, roomResponse.data!.room.members))
                );
                setMessages(freshMessages);
              }
            }
          } catch (error) {
            console.error('[MemberRemoved] Failed to refresh room data:', error);
            // Fallback: just filter out the removed member
            setCurrentRoom((prev) =>
              prev ? { ...prev, members: prev.members.filter((m) => m.id !== event.memberId) } : null
            );
          } finally {
            setIsRotatingKey(false);
          }
        }
      }
      refreshChats();
    });

    const unsubMemberLeft = socketService.onMemberLeft(async (event: MemberLeftEvent) => {
      // Member leaving also triggers key rotation - fetch fresh room data
      keyManager.clearRoomKey(event.roomId);
      roomKeysCache.current.delete(event.roomId);

      if (currentRoom?.id === event.roomId) {
        setIsRotatingKey(true);
        try {
          // CRITICAL: Fetch fresh room data to get updated keyVersions for all members
          const roomResponse = await api.getRoom(event.roomId);
          if (roomResponse.success && roomResponse.data) {
            setCurrentRoom((prev) =>
              prev ? { ...prev, members: roomResponse.data!.room.members } : null
            );

            // Re-decrypt existing messages with fresh member data
            if (messages.length > 0) {
              const freshMessages = await Promise.all(
                messages.map((msg) => decryptMessage(msg, event.roomId, roomResponse.data!.room.members))
              );
              setMessages(freshMessages);
            }
          }
        } catch (error) {
          console.error('[MemberLeft] Failed to refresh room data:', error);
          // Fallback: just filter out the member who left
          setCurrentRoom((prev) =>
            prev ? { ...prev, members: prev.members.filter((m) => m.id !== event.memberId) } : null
          );
        } finally {
          setIsRotatingKey(false);
        }
      }
      refreshChats();
    });

    const unsubRoleChanged = socketService.onRoleChanged((event: RoleChangedEvent) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev
            ? {
                ...prev,
                members: prev.members.map((m) =>
                  m.id === event.memberId ? { ...m, role: event.newRole } : m
                ),
              }
            : null
        );
      }
      refreshChats();
    });

    const unsubRoomKeyRotated = socketService.onRoomKeyRotated(async (event: RoomKeyRotatedEvent) => {
      console.log(`[KeyRotation] Received rotation for room ${event.roomId} to version ${event.newKeyVersion}`);

      // FIX-D: Prevent sending messages while we update keys
      setIsRotatingKey(true);

      try {
        // Step 1: Clear all cached keys for this room
        keyManager.clearRoomKey(event.roomId);
        roomKeysCache.current.delete(event.roomId);

        // Step 2: Store new encrypted key
        if (event.encryptedKey) {
          roomKeysCache.current.set(event.roomId, event.encryptedKey);
        }

        // Step 3: CRITICAL - Refresh room data to get updated keyVersions for all members
        // This is the main fix for decryption failures after key rotation
        if (currentRoom?.id === event.roomId) {
          try {
            const roomResponse = await api.getRoom(event.roomId);
            if (roomResponse.success && roomResponse.data) {
              const updatedMembers = roomResponse.data.room.members;

              // Update currentRoom with fresh member data (includes updated keyVersion)
              setCurrentRoom((prev) =>
                prev
                  ? {
                      ...prev,
                      members: updatedMembers,
                    }
                  : null
              );

              // Step 4: Re-decrypt all messages with fresh room data
              // This fixes any messages that previously failed due to stale keyVersion
              if (messages.length > 0) {
                const freshMessages = await Promise.all(
                  messages.map((msg) => decryptMessage(msg, event.roomId, updatedMembers))
                );
                setMessages(freshMessages);
              }
            }
          } catch (error) {
            console.error('[KeyRotation] Failed to refresh room after key rotation:', error);
          }
        }

        // Step 5: Refresh sidebar chats
        refreshChats();
      } finally {
        // FIX-D: Release the lock
        setIsRotatingKey(false);
      }
    });

    const unsubGroupUpdated = socketService.onGroupUpdated((event: GroupUpdatedEvent) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev
            ? {
                ...prev,
                name: event.changes.name ?? prev.name,
                photoUrl: event.changes.photoUrl !== undefined ? event.changes.photoUrl : prev.photoUrl,
              }
            : null
        );
      }
      refreshChats();
    });

    const unsubGroupDeleted = socketService.onGroupDeleted((event: GroupDeletedEvent) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom(null);
      }
      keyManager.clearAllRoomKeys(event.roomId);
      roomKeysCache.current.delete(event.roomId);
      refreshChats();
    });

    const unsubGroupCreated = socketService.onGroupCreated(() => {
      // Refresh chats to show the new group
      refreshChats();
    });

    // FIX-11: Clear key rotation flag on socket disconnect
    const unsubDisconnect = socketService.onDisconnect(() => {
      setIsRotatingKey(false);
    });

    // FIX-13: Reload messages on reconnect to catch any missed during disconnect
    const unsubReconnect = socketService.onReconnect(async () => {
      if (currentRoom) {
        try {
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
        } catch (error) {
          console.error('Failed to sync messages after reconnect:', error);
        }
      }
      refreshChats();
    });

    return () => {
      unsubMessage();
      unsubTyping();
      unsubStopTyping();
      unsubUnreadCount();
      unsubPresence();
      unsubMemberAdded();
      unsubMemberRemoved();
      unsubMemberLeft();
      unsubRoleChanged();
      unsubRoomKeyRotated();
      unsubGroupUpdated();
      unsubGroupDeleted();
      unsubGroupCreated();
      unsubDisconnect();
      unsubReconnect();
    };
  }, [isAuthenticated, user, currentRoom, decryptMessage, refreshChats]);

  // Load messages when room changes
  useEffect(() => {
    // FIX-1: Clear messages immediately on ANY room change (not just when null)
    // This prevents showing stale messages from previous room when switching
    setMessages([]);
    setHasMoreMessages(true);

    if (!currentRoom) {
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

  // Send message with optimistic updates
  const sendMessage = useCallback(async (
    content: string,
    type: string = 'text',
    mediaUrl?: string,
    mediaType?: string
  ) => {
    if (!currentRoom || !user) return;

    // Prevent sending messages while key rotation is in progress
    if (isRotatingKey) {
      throw new Error('Please wait, security key is being updated');
    }

    // Create optimistic message with temporary ID
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

    // Add optimistic message immediately
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const encryptedRoomKey = await getEncryptedRoomKey(currentRoom.id, currentRoom.members);
      const { ciphertext, iv, authTag } = await keyManager.encryptMessage(
        currentRoom.id,
        encryptedRoomKey,
        content
      );

      // FIX-E: Get the current member's keyVersion to send with the message
      // This ensures the message is stored with the version that was used for encryption
      const currentMember = currentRoom.members.find((m) => m.id === user.id);
      const keyVersion = currentMember?.keyVersion;

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
        // Cache the plaintext for own messages
        localStorage.setItem(`msg:${response.data.message._id}`, content);

        // Replace optimistic message with real one
        setMessages((prev) => prev.map((msg) =>
          msg._id === tempId
            ? { ...response.data!.message, decryptedContent: content, pending: false }
            : msg
        ));
      } else {
        // Mark message as failed
        setMessages((prev) => prev.map((msg) =>
          msg._id === tempId
            ? { ...msg, pending: false, failed: true }
            : msg
        ));
        throw new Error(response.error || 'Failed to send message');
      }
    } catch (error) {
      // Mark message as failed
      setMessages((prev) => prev.map((msg) =>
        msg._id === tempId
          ? { ...msg, pending: false, failed: true }
          : msg
      ));
      console.error('Failed to send message:', error);
      throw error;
    }
  }, [currentRoom, user, getEncryptedRoomKey, isRotatingKey]);

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

  // Create group room
  const createGroupRoom = useCallback(async (
    memberIds: string[],
    name: string
  ): Promise<Room> => {
    const response = await api.createGroupRoom(memberIds, name);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to create group');
    }
    await refreshChats();
    return response.data.room;
  }, [refreshChats]);

  // Add member to group (with proper key encryption)
  const addMember = useCallback(async (roomId: string, userId: string): Promise<void> => {
    // Get the new user's public key to encrypt the room key for them
    const userResponse = await api.getUserPublicKey(userId);
    if (!userResponse.success || !userResponse.data) {
      throw new Error('Failed to get user public key');
    }
    const newMemberPublicKey = userResponse.data.publicKey;

    // Get current room key (encrypted for current user)
    const roomKeyResponse = await api.getRoomKey(roomId);
    if (!roomKeyResponse.success || !roomKeyResponse.data) {
      throw new Error('Failed to get room key');
    }

    // Decrypt the room key with current user's private key, then re-encrypt for new member
    const roomKeyBytes = await keyManager.decryptRoomKeyToRawBytes(roomKeyResponse.data.encryptedRoomKey);
    const encryptedRoomKeyForNewMember = await keyManager.encryptRoomKeyForUser(roomKeyBytes, newMemberPublicKey);

    // Get historical keys and encrypt them for the new member (for full message history access)
    const historyResponse = await api.getRoomKeyHistory(roomId);
    const historicalKeys: Array<{ version: number; encryptedKey: string }> = [];

    if (historyResponse.success && historyResponse.data) {
      for (const keyEntry of historyResponse.data.keyHistory) {
        // Decrypt each historical key with current user's private key
        const historicalKeyBytes = await keyManager.decryptRoomKeyToRawBytes(keyEntry.encryptedRoomKey);
        // Re-encrypt for the new member
        const encryptedHistoricalKey = await keyManager.encryptRoomKeyForUser(historicalKeyBytes, newMemberPublicKey);
        historicalKeys.push({
          version: keyEntry.version,
          encryptedKey: encryptedHistoricalKey,
        });
      }
    }

    // Add member with properly encrypted keys
    const response = await api.addMember(
      roomId,
      userId,
      encryptedRoomKeyForNewMember,
      historicalKeys
    );

    if (!response.success) {
      throw new Error(response.error || 'Failed to add member');
    }

    await refreshChats();
  }, [refreshChats]);

  // Remove member from group (with key rotation)
  const removeMember = useCallback(async (roomId: string, userId: string): Promise<void> => {
    // Set rotating flag to prevent message sending during key rotation
    setIsRotatingKey(true);
    try {
      // Step 1: Call backend to remove member (archives old key, increments version)
      const response = await api.removeMember(roomId, userId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to remove member');
      }

      // Step 2: Generate a NEW room key
      const newRoomKey = await keyManager.generateNewRoomKey();
      const newRoomKeyBytes = await keyManager.exportRoomKeyToBytes(newRoomKey);

      // Step 3: Get remaining members' public keys and encrypt new key for each
      const roomResponse = await api.getRoom(roomId);
      if (!roomResponse.success || !roomResponse.data) {
        throw new Error('Failed to get updated room');
      }

      const encryptedKeys: Record<string, string> = {};
      for (const member of roomResponse.data.room.members) {
        // member.publicKey should be available from the room data
        if (member.publicKey) {
          encryptedKeys[member.id] = await keyManager.encryptRoomKeyForUser(newRoomKeyBytes, member.publicKey);
        }
      }

      // Step 4: Submit rotated keys to backend
      const rotateResponse = await api.rotateRoomKey(roomId, encryptedKeys);
      if (!rotateResponse.success) {
        throw new Error(rotateResponse.error || 'Failed to rotate room key after member removal');
      }

      // Step 5: Clear local cache
      keyManager.clearRoomKey(roomId);
      roomKeysCache.current.delete(roomId);

      // FIX-H: CRITICAL - Update currentRoom with fresh member data (including updated keyVersions)
      // Without this, the admin's currentRoom.members[].keyVersion is stale and messages
      // will be sent with the wrong keyVersion, causing decryption failures for other users
      if (currentRoom?.id === roomId) {
        const freshRoom = await api.getRoom(roomId);
        if (freshRoom.success && freshRoom.data) {
          setCurrentRoom((prev) =>
            prev ? { ...prev, members: freshRoom.data!.room.members } : null
          );
        }
      }

      await refreshChats();
    } finally {
      setIsRotatingKey(false);
    }
  }, [refreshChats, currentRoom]);

  // Leave room
  const leaveRoom = useCallback(async (roomId: string): Promise<void> => {
    const response = await api.leaveRoom(roomId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to leave room');
    }
    // Clear room from state
    if (currentRoom?.id === roomId) {
      setCurrentRoom(null);
    }
    keyManager.clearAllRoomKeys(roomId);
    roomKeysCache.current.delete(roomId);
    await refreshChats();
  }, [refreshChats, currentRoom]);

  // Promote member to admin
  const promoteMember = useCallback(async (roomId: string, userId: string): Promise<void> => {
    const response = await api.promoteMember(roomId, userId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to promote member');
    }
    await refreshChats();
  }, [refreshChats]);

  // Demote member from admin
  const demoteMember = useCallback(async (roomId: string, userId: string): Promise<void> => {
    const response = await api.demoteMember(roomId, userId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to demote member');
    }
    await refreshChats();
  }, [refreshChats]);

  // Update group
  const updateGroup = useCallback(async (
    roomId: string,
    data: { name?: string; photoUrl?: string | null }
  ): Promise<void> => {
    const response = await api.updateGroup(roomId, data);
    if (!response.success) {
      throw new Error(response.error || 'Failed to update group');
    }
    await refreshChats();
  }, [refreshChats]);

  // Delete group
  const deleteGroup = useCallback(async (roomId: string): Promise<void> => {
    const response = await api.deleteGroup(roomId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete group');
    }
    if (currentRoom?.id === roomId) {
      setCurrentRoom(null);
    }
    keyManager.clearAllRoomKeys(roomId);
    roomKeysCache.current.delete(roomId);
    await refreshChats();
  }, [refreshChats, currentRoom]);

  // Delete message
  const deleteMessage = useCallback(async (roomId: string, messageId: string): Promise<void> => {
    const response = await api.deleteMessage(roomId, messageId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete message');
    }
    setMessages((prev) => prev.filter((m) => m._id !== messageId));
  }, []);

  // Check if a chat is a group chat
  const isGroupChat = useCallback((chat: Chat): boolean => {
    return chat.members.length > 2 || (chat.name !== null && chat.otherUser === null);
  }, []);

  // Get current user's role in a room
  const getUserRole = useCallback((roomId: string): 'admin' | 'member' | null => {
    const chat = chats.find((c) => c.id === roomId);
    if (!chat || !user) return null;
    const member = chat.members.find((m) => m.id === user.id);
    if (!member) return null;
    return member.role as 'admin' | 'member';
  }, [chats, user]);

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
        // Group functions
        createGroupRoom,
        addMember,
        removeMember,
        leaveRoom,
        promoteMember,
        demoteMember,
        updateGroup,
        deleteGroup,
        deleteMessage,
        isGroupChat,
        getUserRole,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export default ChatProvider;
