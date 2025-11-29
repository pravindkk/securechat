/**
 * Rooms Context
 *
 * Manages room/chat list state, current room selection, and room CRUD operations.
 * Handles socket events for room updates.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  Chat,
  Room,
  MemberAddedEvent,
  MemberRemovedEvent,
  MemberLeftEvent,
  RoleChangedEvent,
  GroupUpdatedEvent,
  GroupDeletedEvent,
} from '../types';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { useAuth } from './AuthContext';
import { useEncryption } from './EncryptionContext';

interface RoomsContextType {
  chats: Chat[];
  currentRoom: Room | null;
  isLoadingChats: boolean;
  setCurrentRoom: (room: Room | null) => void;
  refreshChats: () => Promise<void>;
  createRoom: (isPrivate: boolean, memberIds: string[], name?: string) => Promise<Room>;
  createGroupRoom: (memberIds: string[], name: string) => Promise<Room>;
  isGroupChat: (chat: Chat) => boolean;
  getUserRole: (roomId: string) => 'admin' | 'member' | null;
  updateCurrentRoomMembers: (members: Room['members']) => void;
}

const RoomsContext = createContext<RoomsContextType | null>(null);

export const useRooms = (): RoomsContextType => {
  const context = useContext(RoomsContext);
  if (!context) {
    throw new Error('useRooms must be used within a RoomsProvider');
  }
  return context;
};

interface RoomsProviderProps {
  children: ReactNode;
}

export const RoomsProvider: React.FC<RoomsProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const { clearRoomKey, clearAllRoomKeys, setIsRotatingKey } = useEncryption();

  const [chats, setChats] = useState<Chat[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(false);

  // Load chats from API
  const refreshChats = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoadingChats(true);
    try {
      const response = await api.getChats();
      if (response.success && response.data) {
        setChats(response.data.chats);
      }
    } catch (error) {
      console.error('[RoomsContext] Failed to load chats:', error);
    } finally {
      setIsLoadingChats(false);
    }
  }, [isAuthenticated]);

  // Initial load and cleanup on auth change
  useEffect(() => {
    if (isAuthenticated) {
      refreshChats();
    } else {
      setChats([]);
      setCurrentRoom(null);
    }
  }, [isAuthenticated, refreshChats]);

  // Socket event handlers for room updates
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Presence updates
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

    // Unread count updates
    const unsubUnreadCount = socketService.onUnreadCountUpdate((event) => {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === event.roomId ? { ...chat, unreadCount: event.count } : chat
        )
      );
    });

    // Member added
    const unsubMemberAdded = socketService.onMemberAdded((event: MemberAddedEvent) => {
      refreshChats();
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

    // Member removed
    const unsubMemberRemoved = socketService.onMemberRemoved(async (event: MemberRemovedEvent) => {
      if (event.memberId === user?.id) {
        // Current user was removed
        if (currentRoom?.id === event.roomId) {
          setCurrentRoom(null);
        }
        clearAllRoomKeys(event.roomId);
      } else {
        // Someone else was removed
        clearRoomKey(event.roomId);

        if (currentRoom?.id === event.roomId) {
          setIsRotatingKey(true);
          try {
            const roomResponse = await api.getRoom(event.roomId);
            if (roomResponse.success && roomResponse.data) {
              setCurrentRoom((prev) =>
                prev ? { ...prev, members: roomResponse.data!.room.members } : null
              );
            }
          } catch (error) {
            console.error('[RoomsContext] Failed to refresh room:', error);
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
    });

    // Member left
    const unsubMemberLeft = socketService.onMemberLeft(async (event: MemberLeftEvent) => {
      clearRoomKey(event.roomId);

      if (currentRoom?.id === event.roomId) {
        setIsRotatingKey(true);
        try {
          const roomResponse = await api.getRoom(event.roomId);
          if (roomResponse.success && roomResponse.data) {
            setCurrentRoom((prev) =>
              prev ? { ...prev, members: roomResponse.data!.room.members } : null
            );
          }
        } catch (error) {
          console.error('[RoomsContext] Failed to refresh room:', error);
          setCurrentRoom((prev) =>
            prev
              ? { ...prev, members: prev.members.filter((m) => m.id !== event.memberId) }
              : null
          );
        } finally {
          setIsRotatingKey(false);
        }
      }
      refreshChats();
    });

    // Role changed
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

    // Group updated
    const unsubGroupUpdated = socketService.onGroupUpdated((event: GroupUpdatedEvent) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom((prev) =>
          prev
            ? {
                ...prev,
                name: event.changes.name ?? prev.name,
                photoUrl:
                  event.changes.photoUrl !== undefined ? event.changes.photoUrl : prev.photoUrl,
              }
            : null
        );
      }
      refreshChats();
    });

    // Group deleted
    const unsubGroupDeleted = socketService.onGroupDeleted((event: GroupDeletedEvent) => {
      if (currentRoom?.id === event.roomId) {
        setCurrentRoom(null);
      }
      clearAllRoomKeys(event.roomId);
      refreshChats();
    });

    // Group created
    const unsubGroupCreated = socketService.onGroupCreated(() => {
      refreshChats();
    });

    return () => {
      unsubPresence();
      unsubUnreadCount();
      unsubMemberAdded();
      unsubMemberRemoved();
      unsubMemberLeft();
      unsubRoleChanged();
      unsubGroupUpdated();
      unsubGroupDeleted();
      unsubGroupCreated();
    };
  }, [
    isAuthenticated,
    user,
    currentRoom,
    refreshChats,
    clearRoomKey,
    clearAllRoomKeys,
    setIsRotatingKey,
  ]);

  // Create private room
  const createRoom = useCallback(
    async (isPrivate: boolean, memberIds: string[], name?: string): Promise<Room> => {
      const response = await api.createRoom(memberIds, name, isPrivate);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create room');
      }
      await refreshChats();
      return response.data.room;
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
      return response.data.room;
    },
    [refreshChats]
  );

  // Check if chat is a group
  const isGroupChat = useCallback((chat: Chat): boolean => {
    return chat.members.length > 2 || (chat.name !== null && chat.otherUser === null);
  }, []);

  // Get user's role in a room
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

  // Update current room members (called from other contexts)
  const updateCurrentRoomMembers = useCallback((members: Room['members']) => {
    setCurrentRoom((prev) => (prev ? { ...prev, members } : null));
  }, []);

  return (
    <RoomsContext.Provider
      value={{
        chats,
        currentRoom,
        isLoadingChats,
        setCurrentRoom,
        refreshChats,
        createRoom,
        createGroupRoom,
        isGroupChat,
        getUserRole,
        updateCurrentRoomMembers,
      }}
    >
      {children}
    </RoomsContext.Provider>
  );
};

export default RoomsProvider;
