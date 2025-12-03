'use client';

import React, { useState } from 'react';
import { Box } from '@mui/material';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import EmptyState from './EmptyState';
import GroupInfoPanel from './GroupInfoPanel';
import NewChatDialog from './NewChatDialog';
import NewGroupDialog from './NewGroupDialog';
import { useChat } from '@/hooks/useChat';

export default function ChatPage() {
  const { currentRoom } = useChat();

  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Sidebar
        onNewChat={() => setShowNewChat(true)}
        onNewGroup={() => setShowNewGroup(true)}
      />

      {currentRoom ? (
        <ChatWindow room={currentRoom} onShowInfo={() => setShowInfo(true)} />
      ) : (
        <EmptyState />
      )}

      {showInfo && currentRoom && (
        <GroupInfoPanel room={currentRoom} onClose={() => setShowInfo(false)} />
      )}

      <NewChatDialog open={showNewChat} onClose={() => setShowNewChat(false)} />
      <NewGroupDialog open={showNewGroup} onClose={() => setShowNewGroup(false)} />
    </Box>
  );
}
