/**
 * Chat Providers
 *
 * Combined provider that wraps all chat-related contexts in the correct order.
 * Also provides a backward-compatible useChat hook for existing components.
 */

import React, { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { EncryptionProvider, useEncryption } from './EncryptionContext';
import { RoomsProvider, useRooms } from './RoomsContext';
import { GroupProvider, useGroup } from './GroupContext';
import { MessagesProvider, useMessages } from './MessagesContext';

interface ChatProvidersProps {
  children: ReactNode;
}

/**
 * Combined provider that wraps all chat-related contexts
 */
export const ChatProviders: React.FC<ChatProvidersProps> = ({ children }) => {
  const { user } = useAuth();

  return (
    <EncryptionProvider userId={user?.id}>
      <RoomsProvider>
        <GroupProvider>
          <MessagesProvider>{children}</MessagesProvider>
        </GroupProvider>
      </RoomsProvider>
    </EncryptionProvider>
  );
};

/**
 * Backward-compatible useChat hook
 *
 * Combines all split contexts into a single interface matching the original ChatContext.
 * This allows existing components to work without modification.
 */
export const useChat = () => {
  const rooms = useRooms();
  const messages = useMessages();
  const group = useGroup();
  const encryption = useEncryption();

  return {
    // From RoomsContext
    chats: rooms.chats,
    currentRoom: rooms.currentRoom,
    isLoadingChats: rooms.isLoadingChats,
    setCurrentRoom: rooms.setCurrentRoom,
    refreshChats: rooms.refreshChats,
    createRoom: rooms.createRoom,
    createGroupRoom: rooms.createGroupRoom,
    isGroupChat: rooms.isGroupChat,
    getUserRole: rooms.getUserRole,

    // From MessagesContext
    messages: messages.messages,
    isLoadingMessages: messages.isLoadingMessages,
    hasMoreMessages: messages.hasMoreMessages,
    typingUsers: messages.typingUsers,
    sendMessage: messages.sendMessage,
    loadMoreMessages: messages.loadMoreMessages,
    markAsRead: messages.markAsRead,
    deleteMessage: messages.deleteMessage,

    // From GroupContext
    addMember: group.addMember,
    removeMember: group.removeMember,
    leaveRoom: group.leaveRoom,
    promoteMember: group.promoteMember,
    demoteMember: group.demoteMember,
    updateGroup: group.updateGroup,
    deleteGroup: group.deleteGroup,

    // From EncryptionContext (exposed for edge cases)
    isRotatingKey: encryption.isRotatingKey,
  };
};

// Re-export individual hooks for components that want more granular access
export { useRooms } from './RoomsContext';
export { useMessages } from './MessagesContext';
export { useGroup } from './GroupContext';
export { useEncryption } from './EncryptionContext';

export default ChatProviders;
