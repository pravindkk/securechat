/**
 * Group Context
 *
 * Manages group-specific operations: adding/removing members,
 * promoting/demoting admins, updating group settings, and key rotation.
 */

import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';
import { useRooms } from './RoomsContext';
import { useEncryption } from './EncryptionContext';

interface GroupContextType {
  addMember: (roomId: string, userId: string) => Promise<void>;
  removeMember: (roomId: string, userId: string) => Promise<void>;
  leaveRoom: (roomId: string) => Promise<void>;
  promoteMember: (roomId: string, userId: string) => Promise<void>;
  demoteMember: (roomId: string, userId: string) => Promise<void>;
  updateGroup: (roomId: string, data: { name?: string; photoUrl?: string | null }) => Promise<void>;
  deleteGroup: (roomId: string) => Promise<void>;
}

const GroupContext = createContext<GroupContextType | null>(null);

export const useGroup = (): GroupContextType => {
  const context = useContext(GroupContext);
  if (!context) {
    throw new Error('useGroup must be used within a GroupProvider');
  }
  return context;
};

interface GroupProviderProps {
  children: ReactNode;
}

export const GroupProvider: React.FC<GroupProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const { currentRoom, setCurrentRoom, refreshChats, updateCurrentRoomMembers } = useRooms();
  const {
    clearRoomKey,
    clearAllRoomKeys,
    setIsRotatingKey,
    decryptRoomKeyToRawBytes,
    encryptRoomKeyForUser,
    generateNewRoomKey,
    exportRoomKeyToBytes,
  } = useEncryption();

  // Add member to group with proper key encryption
  const addMember = useCallback(
    async (roomId: string, userId: string): Promise<void> => {
      // Get new user's public key
      const userResponse = await api.getUserPublicKey(userId);
      if (!userResponse.success || !userResponse.data) {
        throw new Error('Failed to get user public key');
      }
      const newMemberPublicKey = userResponse.data.publicKey;

      // Get current room key
      const roomKeyResponse = await api.getRoomKey(roomId);
      if (!roomKeyResponse.success || !roomKeyResponse.data) {
        throw new Error('Failed to get room key');
      }

      // Decrypt and re-encrypt for new member
      const roomKeyBytes = await decryptRoomKeyToRawBytes(roomKeyResponse.data.encryptedRoomKey);
      const encryptedRoomKeyForNewMember = await encryptRoomKeyForUser(
        roomKeyBytes,
        newMemberPublicKey
      );

      // Get and encrypt historical keys
      const historyResponse = await api.getRoomKeyHistory(roomId);
      const historicalKeys: Array<{ version: number; encryptedKey: string }> = [];

      if (historyResponse.success && historyResponse.data) {
        for (const keyEntry of historyResponse.data.keyHistory) {
          const historicalKeyBytes = await decryptRoomKeyToRawBytes(keyEntry.encryptedRoomKey);
          const encryptedHistoricalKey = await encryptRoomKeyForUser(
            historicalKeyBytes,
            newMemberPublicKey
          );
          historicalKeys.push({
            version: keyEntry.version,
            encryptedKey: encryptedHistoricalKey,
          });
        }
      }

      // Add member via API
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
    [refreshChats, decryptRoomKeyToRawBytes, encryptRoomKeyForUser]
  );

  // Remove member with key rotation
  const removeMember = useCallback(
    async (roomId: string, userId: string): Promise<void> => {
      setIsRotatingKey(true);
      try {
        // Step 1: Remove member via API
        const response = await api.removeMember(roomId, userId);
        if (!response.success) {
          throw new Error(response.error || 'Failed to remove member');
        }

        // Step 2: Generate new room key
        const newRoomKey = await generateNewRoomKey();
        const newRoomKeyBytes = await exportRoomKeyToBytes(newRoomKey);

        // Step 3: Get remaining members and encrypt new key for each
        const roomResponse = await api.getRoom(roomId);
        if (!roomResponse.success || !roomResponse.data) {
          throw new Error('Failed to get updated room');
        }

        const encryptedKeys: Record<string, string> = {};
        for (const member of roomResponse.data.room.members) {
          if (member.publicKey) {
            encryptedKeys[member.id] = await encryptRoomKeyForUser(
              newRoomKeyBytes,
              member.publicKey
            );
          }
        }

        // Step 4: Submit rotated keys
        const rotateResponse = await api.rotateRoomKey(roomId, encryptedKeys);
        if (!rotateResponse.success) {
          throw new Error(rotateResponse.error || 'Failed to rotate room key');
        }

        // Step 5: Clear local cache
        clearRoomKey(roomId);

        // Step 6: Update current room with fresh member data
        if (currentRoom?.id === roomId) {
          const freshRoom = await api.getRoom(roomId);
          if (freshRoom.success && freshRoom.data) {
            updateCurrentRoomMembers(freshRoom.data.room.members);
          }
        }

        await refreshChats();
      } finally {
        setIsRotatingKey(false);
      }
    },
    [
      currentRoom,
      refreshChats,
      setIsRotatingKey,
      clearRoomKey,
      generateNewRoomKey,
      exportRoomKeyToBytes,
      encryptRoomKeyForUser,
      updateCurrentRoomMembers,
    ]
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

      clearAllRoomKeys(roomId);
      await refreshChats();
    },
    [currentRoom, setCurrentRoom, clearAllRoomKeys, refreshChats]
  );

  // Promote member to admin
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

  // Demote member from admin
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

  // Update group settings
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

      clearAllRoomKeys(roomId);
      await refreshChats();
    },
    [currentRoom, setCurrentRoom, clearAllRoomKeys, refreshChats]
  );

  return (
    <GroupContext.Provider
      value={{
        addMember,
        removeMember,
        leaveRoom,
        promoteMember,
        demoteMember,
        updateGroup,
        deleteGroup,
      }}
    >
      {children}
    </GroupContext.Provider>
  );
};

export default GroupProvider;
