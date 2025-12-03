'use client';

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
} from '@/types';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import { keyManager } from '@/lib/keyManager';
import { useAuth } from './useAuth';

interface ChatContextType {
  chats: Chat[];
  currentRoom: Room | null;
  messages: Message[];
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  typingUsers: Map<string, Map<string, string>>;
  setCurrentRoom: (room: Room | null) => void;
  sendMessage: (
    content: string,
    type?: string,
    mediaUrl?: string,
    mediaType?: string
  ) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  markAsRead: (roomId: string) => void;
  createRoom: (isPrivate: boolean, memberIds: string[], name?: string) => Promise<Room>;
  refreshChats: () => Promise<void>;
  createGroupRoom: (memberIds: string[], name: string) => Promise<Room>;
  addMember: (roomId: string, userId: string) => Promise<void>;
  removeMember: (roomId: string, userId: string) => Promise<void>;
  leaveRoom: (roomId: string) => Promise<void>;
  promoteMember: (roomId: string, userId: string) => Promise<void>;
  demoteMember: (roomId: string, userId: string) => Promise<void>;
  updateGroup: (
    roomId: string,
    data: { name?: string; photoUrl?: string | null }
  ) => Promise<void>;
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
  const [typingUsers, setTypingUsers] = useState<Map<string, Map<string, string>>>(
    new Map()
  );
  const [isRotatingKey, setIsRotatingKey] = useState(false);
  const typingTimeouts = useRef<Map<string, Map<string, NodeJS.Timeout>>>(new Map());
  const roomKeysCache = useRef<Map<string, string>>(new Map());

  // Get encrypted room key for current user
  const getEncryptedRoomKey = useCallback(
    async (roomId: string, members: RoomMember[]): Promise<string> => {
      if (!keyManager.isInitialized()) {
        throw new Error('Encryption keys not initialized. Please log out and log in again.');
      }

      if (roomKeysCache.current.has(roomId)) {
        return roomKeysCache.current.get(roomId)!;
      }

      const currentMember = members.find((m) => m.id === user?.id);
      if (currentMember?.encryptedRoomKey) {
        roomKeysCache.current.set(roomId, currentMember.encryptedRoomKey);
        return currentMember.encryptedRoomKey;
      }

      const response = await api.getRoomKey(roomId);
      if (response.success && response.data) {
        roomKeysCache.current.set(roomId, response.data.encryptedRoomKey);
        return response.data.encryptedRoomKey;
      }

      throw new Error('Failed to get room key');
    },
    [user]
  );

  // Decrypt a message
  const decryptMessage = useCallback(
    async (message: Message, roomId: string, members: RoomMember[]): Promise<Message> => {
      try {
        if (message.type === 'system') {
          return { ...message, decryptedContent: message.encryptedContent || '' };
        }

        if (message.senderId === user?.id) {
          const cachedContent = localStorage.getItem(`msg:${message._id}`);
          if (cachedContent) {
            return { ...message, decryptedContent: cachedContent };
          }
        }

        const currentMember = members.find((m) => m.id === user?.id);
        const currentKeyVersion = currentMember?.keyVersion || 1;

        let encryptedRoomKey: string;

        if (message.keyVersion && message.keyVersion !== currentKeyVersion) {
          const keyResponse = await api.getRoomKeyVersion(roomId, message.keyVersion);
          if (keyResponse.success && keyResponse.data) {
            encryptedRoomKey = keyResponse.data.encryptedRoomKey;
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
            return { ...message, decryptedContent: '[Key version unavailable]' };
          }
        }

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
    },
    [user, getEncryptedRoomKey]
  );

  // Load chats
  const refreshChats = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoadingChats(true);
    try {
      const response = await api.getChats();
      if (response.success && response.data) {
        setChats(response.data);
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

    const unsubTyping = socketService.onTyping((event) => {
      if (event.userId !== user.id) {
        const roomTimeouts = typingTimeouts.current.get(event.roomId);
        if (roomTimeouts?.has(event.userId)) {
          clearTimeout(roomTimeouts.get(event.userId)!);
        }

        setTypingUsers((prev) => {
          const newMap = new Map(prev);
          const roomTyping = newMap.get(event.roomId) || new Map<string, string>();
          roomTyping.set(event.userId, event.userName);
          newMap.set(event.roomId, roomTyping);
          return newMap;
        });

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
          const timeouts = typingTimeouts.current.get(event.roomId);
          if (timeouts) {
            timeouts.delete(event.userId);
          }
        }, 5000);

        if (!typingTimeouts.current.has(event.roomId)) {
          typingTimeouts.current.set(event.roomId, new Map());
        }
        typingTimeouts.current.get(event.roomId)!.set(event.userId, timeoutId);
      }
    });

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

    const unsubUnreadCount = socketService.onUnreadCountUpdate((event) => {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === event.roomId ? { ...chat, unreadCount: event.unreadCount } : chat
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

    const unsubMemberAdded = socketService.onMemberAdded((event: MemberAddedEvent) => {
      refreshChats();
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev ? { ...prev, members: [...prev.members, event.member] } : null
        );
      }
    });

    const unsubMemberRemoved = socketService.onMemberRemoved(
      async (event: MemberRemovedEvent) => {
        if (event.memberId === user?.id) {
          if (currentRoom?.id === event.roomId) {
            setCurrentRoom(null);
          }
          keyManager.clearAllRoomKeys(event.roomId);
          roomKeysCache.current.delete(event.roomId);
        } else {
          keyManager.clearRoomKey(event.roomId);
          roomKeysCache.current.delete(event.roomId);

          if (currentRoom?.id === event.roomId) {
            setIsRotatingKey(true);
            try {
              const roomResponse = await api.getRoom(event.roomId);
              if (roomResponse.success && roomResponse.data) {
                setCurrentRoom((prev) =>
                  prev ? { ...prev, members: roomResponse.data!.members } : null
                );

                if (messages.length > 0) {
                  const freshMessages = await Promise.all(
                    messages.map((msg) =>
                      decryptMessage(msg, event.roomId, roomResponse.data!.members)
                    )
                  );
                  setMessages(freshMessages);
                }
              }
            } catch (error) {
              console.error('[MemberRemoved] Failed to refresh room data:', error);
              setCurrentRoom((prev) =>
                prev
                  ? { ...prev, members: prev.members.filter((m) => m.id !== event.memberId) }
                  : null
              );
            } finally {
              setIsRotatingKey(false);
            }
          }
        }
        refreshChats();
      }
    );

    const unsubMemberLeft = socketService.onMemberLeft(async (event: any) => {
      keyManager.clearRoomKey(event.roomId);
      roomKeysCache.current.delete(event.roomId);

      if (currentRoom?.id === event.roomId) {
        setIsRotatingKey(true);
        try {
          const roomResponse = await api.getRoom(event.roomId);
          if (roomResponse.success && roomResponse.data) {
            setCurrentRoom((prev) =>
              prev ? { ...prev, members: roomResponse.data!.members } : null
            );

            if (messages.length > 0) {
              const freshMessages = await Promise.all(
                messages.map((msg) =>
                  decryptMessage(msg, event.roomId, roomResponse.data!.members)
                )
              );
              setMessages(freshMessages);
            }
          }
        } catch (error) {
          console.error('[MemberLeft] Failed to refresh room data:', error);
          setCurrentRoom((prev) =>
            prev
              ? { ...prev, members: prev.members.filter((m) => m.id !== (event.memberId || event.userId)) }
              : null
          );
        } finally {
          setIsRotatingKey(false);
        }
      }
      refreshChats();
    });

    const unsubRoleChanged = socketService.onRoleChanged((event: any) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev
            ? {
                ...prev,
                members: prev.members.map((m) =>
                  m.id === (event.memberId || event.userId) ? { ...m, role: event.newRole } : m
                ),
              }
            : null
        );
      }
      refreshChats();
    });

    const unsubRoomKeyRotated = socketService.onRoomKeyRotated(
      async (event: RoomKeyRotatedEvent) => {
        console.log(
          `[KeyRotation] Received rotation for room ${event.roomId} to version ${event.newKeyVersion}`
        );

        setIsRotatingKey(true);

        try {
          keyManager.clearRoomKey(event.roomId);
          roomKeysCache.current.delete(event.roomId);

          if (event.encryptedKey) {
            roomKeysCache.current.set(event.roomId, event.encryptedKey);
          }

          if (currentRoom?.id === event.roomId) {
            try {
              const roomResponse = await api.getRoom(event.roomId);
              if (roomResponse.success && roomResponse.data) {
                const updatedMembers = roomResponse.data.members;

                setCurrentRoom((prev) =>
                  prev ? { ...prev, members: updatedMembers } : null
                );

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

          refreshChats();
        } finally {
          setIsRotatingKey(false);
        }
      }
    );

    const unsubGroupUpdated = socketService.onGroupUpdated((event: any) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev
            ? {
                ...prev,
                name: (event.changes?.name || event.name) ?? prev.name,
                photoUrl:
                  (event.changes?.photoUrl ?? event.photoUrl) !== undefined
                    ? (event.changes?.photoUrl ?? event.photoUrl)
                    : prev.photoUrl,
              }
            : null
        );
      }
      refreshChats();
    });

    const unsubGroupDeleted = socketService.onGroupDeleted((event: any) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom(null);
      }
      keyManager.clearAllRoomKeys(event.roomId);
      roomKeysCache.current.delete(event.roomId);
      refreshChats();
    });

    const unsubGroupCreated = socketService.onGroupCreated(() => {
      refreshChats();
    });

    const unsubDisconnect = socketService.onDisconnect(() => {
      setIsRotatingKey(false);
    });

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
  }, [isAuthenticated, user, currentRoom, messages, decryptMessage, refreshChats]);

  // Load messages when room changes
  useEffect(() => {
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

  // Send message
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
        const encryptedRoomKey = await getEncryptedRoomKey(
          currentRoom.id,
          currentRoom.members
        );
        const { ciphertext, iv, authTag } = await keyManager.encryptMessage(
          currentRoom.id,
          encryptedRoomKey,
          content
        );

        const currentMember = currentRoom.members.find((m) => m.id === user.id);
        const keyVersion = currentMember?.keyVersion;

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
          localStorage.setItem(`msg:${response.data._id}`, content);

          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === tempId
                ? { ...response.data!, decryptedContent: content, pending: false }
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
        console.error('Failed to send message:', error);
        throw error;
      }
    },
    [currentRoom, user, getEncryptedRoomKey, isRotatingKey]
  );

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
      prev.map((chat) => (chat.id === roomId ? { ...chat, unreadCount: 0 } : chat))
    );
  }, []);

  // Create room
  const createRoom = useCallback(
    async (isPrivate: boolean, memberIds: string[], name?: string): Promise<Room> => {
      const response = await api.createRoom(memberIds, name, isPrivate);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create room');
      }
      await refreshChats();
      return response.data;
    },
    [refreshChats]
  );

  // Create group room
  const createGroupRoom = useCallback(
    async (memberIds: string[], name: string): Promise<Room> => {
      const response = await api.createGroupRoom(memberIds, name);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create group');
      }
      await refreshChats();
      return response.data;
    },
    [refreshChats]
  );

  // Add member
  const addMember = useCallback(
    async (roomId: string, userId: string): Promise<void> => {
      const userResponse = await api.getUserPublicKey(userId);
      if (!userResponse.success || !userResponse.data) {
        throw new Error('Failed to get user public key');
      }
      const newMemberPublicKey = userResponse.data.publicKey;

      const roomKeyResponse = await api.getRoomKey(roomId);
      if (!roomKeyResponse.success || !roomKeyResponse.data) {
        throw new Error('Failed to get room key');
      }

      const roomKeyBytes = await keyManager.decryptRoomKeyToRawBytes(
        roomKeyResponse.data.encryptedRoomKey
      );
      const encryptedRoomKeyForNewMember = await keyManager.encryptRoomKeyForUser(
        roomKeyBytes,
        newMemberPublicKey
      );

      const historyResponse = await api.getRoomKeyHistory(roomId);
      const historicalKeys: Array<{ version: number; encryptedKey: string }> = [];

      if (historyResponse.success && historyResponse.data) {
        for (const keyEntry of historyResponse.data.keyHistory) {
          const historicalKeyBytes = await keyManager.decryptRoomKeyToRawBytes(
            keyEntry.encryptedRoomKey
          );
          const encryptedHistoricalKey = await keyManager.encryptRoomKeyForUser(
            historicalKeyBytes,
            newMemberPublicKey
          );
          historicalKeys.push({
            version: keyEntry.version,
            encryptedKey: encryptedHistoricalKey,
          });
        }
      }

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
    },
    [refreshChats]
  );

  // Remove member
  const removeMember = useCallback(
    async (roomId: string, userId: string): Promise<void> => {
      setIsRotatingKey(true);
      try {
        const response = await api.removeMember(roomId, userId);
        if (!response.success) {
          throw new Error(response.error || 'Failed to remove member');
        }

        const newRoomKey = await keyManager.generateNewRoomKey();
        const newRoomKeyBytes = await keyManager.exportRoomKeyToBytes(newRoomKey);

        const roomResponse = await api.getRoom(roomId);
        if (!roomResponse.success || !roomResponse.data) {
          throw new Error('Failed to get updated room');
        }

        const encryptedKeys: Record<string, string> = {};
        for (const member of roomResponse.data.members) {
          if (member.publicKey) {
            encryptedKeys[member.id] = await keyManager.encryptRoomKeyForUser(
              newRoomKeyBytes,
              member.publicKey
            );
          }
        }

        const rotateResponse = await api.rotateRoomKey(roomId, encryptedKeys);
        if (!rotateResponse.success) {
          throw new Error(
            rotateResponse.error || 'Failed to rotate room key after member removal'
          );
        }

        keyManager.clearRoomKey(roomId);
        roomKeysCache.current.delete(roomId);

        if (currentRoom?.id === roomId) {
          const freshRoom = await api.getRoom(roomId);
          if (freshRoom.success && freshRoom.data) {
            setCurrentRoom((prev) =>
              prev ? { ...prev, members: freshRoom.data!.members } : null
            );
          }
        }

        await refreshChats();
      } finally {
        setIsRotatingKey(false);
      }
    },
    [refreshChats, currentRoom]
  );

  // Leave room
  const leaveRoom = useCallback(
    async (roomId: string): Promise<void> => {
      const response = await api.leaveRoom(roomId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to leave room');
      }
      if (currentRoom?.id === roomId) {
        setCurrentRoom(null);
      }
      keyManager.clearAllRoomKeys(roomId);
      roomKeysCache.current.delete(roomId);
      await refreshChats();
    },
    [refreshChats, currentRoom]
  );

  // Promote member
  const promoteMember = useCallback(
    async (roomId: string, userId: string): Promise<void> => {
      const response = await api.promoteMember(roomId, userId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to promote member');
      }
      await refreshChats();
    },
    [refreshChats]
  );

  // Demote member
  const demoteMember = useCallback(
    async (roomId: string, userId: string): Promise<void> => {
      const response = await api.demoteMember(roomId, userId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to demote member');
      }
      await refreshChats();
    },
    [refreshChats]
  );

  // Update group
  const updateGroup = useCallback(
    async (roomId: string, data: { name?: string; photoUrl?: string | null }): Promise<void> => {
      const response = await api.updateGroup(roomId, data);
      if (!response.success) {
        throw new Error(response.error || 'Failed to update group');
      }
      await refreshChats();
    },
    [refreshChats]
  );

  // Delete group
  const deleteGroup = useCallback(
    async (roomId: string): Promise<void> => {
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
    },
    [refreshChats, currentRoom]
  );

  // Delete message
  const deleteMessage = useCallback(
    async (roomId: string, messageId: string): Promise<void> => {
      const response = await api.deleteMessage(roomId, messageId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete message');
      }
      setMessages((prev) => prev.filter((m) => m._id !== messageId));
    },
    []
  );

  // Check if group chat
  const isGroupChat = useCallback((chat: Chat): boolean => {
    return chat.members.length > 2 || (chat.name !== null && chat.otherUser === null);
  }, []);

  // Get user role
  const getUserRole = useCallback(
    (roomId: string): 'admin' | 'member' | null => {
      const chat = chats.find((c) => c.id === roomId);
      if (!chat || !user) return null;
      const member = chat.members.find((m) => m.id === user.id);
      if (!member) return null;
      return member.role as 'admin' | 'member';
    },
    [chats, user]
  );

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
