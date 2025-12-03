'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Avatar,
  IconButton,
  TextField,
  InputAdornment,
  CircularProgress,
  Paper,
  Tooltip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import InfoIcon from '@mui/icons-material/Info';
import GroupIcon from '@mui/icons-material/Group';
import { Message, Room, RoomMember } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import { socketService } from '@/services/socket';
import SystemMessage from './SystemMessage';

interface ChatWindowProps {
  room: Room;
  onShowInfo: () => void;
}

export default function ChatWindow({ room, onShowInfo }: ChatWindowProps) {
  const { user } = useAuth();
  const {
    messages,
    isLoadingMessages,
    hasMoreMessages,
    typingUsers,
    sendMessage,
    loadMoreMessages,
    isGroupChat,
  } = useChat();

  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle scroll for loading more
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMessages) {
      loadMoreMessages();
    }
  }, [hasMoreMessages, isLoadingMessages, loadMoreMessages]);

  // Typing indicator
  const handleTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socketService.sendTyping(room.id);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socketService.sendStopTyping(room.id);
    }, 2000);
  }, [room.id]);

  // Send message
  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;

    const message = newMessage.trim();
    setNewMessage('');
    setIsSending(true);

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    isTypingRef.current = false;
    socketService.sendStopTyping(room.id);

    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Failed to send message:', error);
      setNewMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  // Get room name
  const getRoomName = (): string => {
    if (room.name) return room.name;
    const otherMember = room.members.find((m) => m.id !== user?.id);
    return otherMember?.name || otherMember?.email || 'Unknown';
  };

  // Get room avatar
  const getRoomAvatar = (): string | undefined => {
    if (room.photoUrl) return room.photoUrl;
    const otherMember = room.members.find((m) => m.id !== user?.id);
    return otherMember?.photoUrl || undefined;
  };

  // Get online status for private chats
  const getOnlineStatus = (): string | null => {
    if (room.members.length > 2) return null;
    const otherMember = room.members.find((m) => m.id !== user?.id);
    return otherMember?.state === 'online' ? 'Online' : null;
  };

  // Get typing indicator text
  const getTypingText = (): string | null => {
    const roomTyping = typingUsers.get(room.id);
    if (!roomTyping || roomTyping.size === 0) return null;

    const names = Array.from(roomTyping.values());
    if (names.length === 1) {
      return `${names[0]} is typing...`;
    } else if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing...`;
    } else {
      return `${names.length} people are typing...`;
    }
  };

  // Render message
  const renderMessage = (message: Message, index: number) => {
    const isOwn = message.senderId === user?.id;
    const showAvatar =
      !isOwn &&
      (index === 0 || messages[index - 1].senderId !== message.senderId);

    if (message.type === 'system') {
      return <SystemMessage key={message._id} message={message} />;
    }

    return (
      <Box
        key={message._id}
        sx={{
          display: 'flex',
          justifyContent: isOwn ? 'flex-end' : 'flex-start',
          mb: 1,
          px: 2,
        }}
      >
        {!isOwn && showAvatar && room.members.length > 2 && (
          <Avatar
            src={message.sender?.photoUrl || undefined}
            sx={{ width: 32, height: 32, mr: 1 }}
          >
            {message.sender?.name?.[0]}
          </Avatar>
        )}
        <Box
          sx={{
            maxWidth: '70%',
            ml: !isOwn && !showAvatar && room.members.length > 2 ? 5 : 0,
          }}
        >
          {!isOwn && showAvatar && room.members.length > 2 && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {message.sender?.name}
            </Typography>
          )}
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: isOwn ? 'primary.main' : 'grey.100',
              color: isOwn ? 'white' : 'text.primary',
              borderRadius: 2,
              opacity: message.pending ? 0.7 : 1,
            }}
          >
            {message.mediaUrl && message.type === 'image' && (
              <Box
                component="img"
                src={message.mediaUrl}
                alt="Image"
                sx={{
                  maxWidth: '100%',
                  maxHeight: 300,
                  borderRadius: 1,
                  mb: message.decryptedContent ? 1 : 0,
                }}
              />
            )}
            {message.decryptedContent && (
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                {message.decryptedContent}
              </Typography>
            )}
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                textAlign: 'right',
                mt: 0.5,
                opacity: 0.7,
              }}
            >
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {message.failed && ' - Failed'}
            </Typography>
          </Paper>
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Avatar src={getRoomAvatar()} sx={{ width: 40, height: 40, mr: 2 }}>
          {room.members.length > 2 ? <GroupIcon /> : getRoomName()[0]}
        </Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {getRoomName()}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {getTypingText() || getOnlineStatus() || `${room.members.length} members`}
          </Typography>
        </Box>
        <Tooltip title="Chat Info">
          <IconButton onClick={onShowInfo}>
            <InfoIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Messages */}
      <Box
        ref={messagesContainerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          py: 2,
          bgcolor: 'background.default',
        }}
      >
        {isLoadingMessages && messages.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {hasMoreMessages && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                {isLoadingMessages ? (
                  <CircularProgress size={24} />
                ) : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ cursor: 'pointer' }}
                    onClick={loadMoreMessages}
                  >
                    Load earlier messages
                  </Typography>
                )}
              </Box>
            )}
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </>
        )}
      </Box>

      {/* Input */}
      <Box
        sx={{
          p: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <TextField
          fullWidth
          placeholder="Type a message..."
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            handleTyping();
          }}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          multiline
          maxRows={4}
          disabled={isSending}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  color="primary"
                  onClick={handleSend}
                  disabled={!newMessage.trim() || isSending}
                >
                  {isSending ? <CircularProgress size={24} /> : <SendIcon />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>
    </Box>
  );
}
