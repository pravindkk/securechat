import React, { useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import { useChat } from '../../contexts/ChatContext';
import { Room } from '../../types';
import EmptyState from './EmptyState';

const ChatPage: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { currentRoom, setCurrentRoom } = useChat();
  const [showChat, setShowChat] = useState(false);

  const handleSelectChat = (room: Room) => {
    setCurrentRoom(room);
    if (isMobile) {
      setShowChat(true);
    }
  };

  const handleBack = () => {
    setShowChat(false);
  };

  if (isMobile) {
    return (
      <Box sx={{ height: '100vh', display: 'flex' }}>
        {!showChat ? (
          <Sidebar
            onSelectChat={handleSelectChat}
            selectedRoomId={currentRoom?.id}
          />
        ) : currentRoom ? (
          <ChatWindow room={currentRoom} onBack={handleBack} isMobile />
        ) : (
          <EmptyState />
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex' }}>
      <Sidebar
        onSelectChat={handleSelectChat}
        selectedRoomId={currentRoom?.id}
      />
      {currentRoom ? (
        <ChatWindow room={currentRoom} />
      ) : (
        <EmptyState />
      )}
    </Box>
  );
};

export default ChatPage;
