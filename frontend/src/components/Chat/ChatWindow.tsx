/**
 * ChatWindow Component
 *
 * Main chat interface with virtualized message list for performance.
 * Supports text and image messages, typing indicators, and group chats.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Avatar,
  Typography,
  CircularProgress,
  InputAdornment,
  Dialog,
  DialogContent,
  Snackbar,
  Alert,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Send,
  ArrowBack,
  Circle,
  Lock,
  Image as ImageIcon,
  Close,
  Group,
  Info,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { Room, Message } from '../../types';
import { socketService } from '../../services/socket';
import { api } from '../../services/api';
import VirtualizedMessageList from './VirtualizedMessageList';
import GroupInfoPanel from './GroupInfoPanel';
import { MessageListSkeleton } from '../Skeletons';

interface ChatWindowProps {
  room: Room;
  onBack?: () => void;
  isMobile?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const ChatWindow: React.FC<ChatWindowProps> = ({ room, onBack, isMobile: isMobileProp }) => {
  const theme = useTheme();
  // Multi-breakpoint responsive design
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isSm = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));

  // Use prop if provided, otherwise detect from breakpoint
  const isMobile = isMobileProp ?? (isXs || isSm);

  const { user } = useAuth();
  const { messages, isLoadingMessages, hasMoreMessages, typingUsers, sendMessage, loadMoreMessages } = useChat();

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isGroup = room.members.length > 2 || (!room.isPrivate && room.name);
  const otherUser = !isGroup ? room.members.find((m) => m.id !== user?.id) : null;

  // Get typing users for current room
  const roomTypingUsers = useMemo(() => {
    const roomTypingMap = typingUsers.get(room.id);
    return roomTypingMap ? Array.from(roomTypingMap.values()) : [];
  }, [typingUsers, room.id]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (isTyping) {
        socketService.sendStopTyping(room.id);
      }
    };
  }, [room.id, isTyping]);

  // Typing indicator handler
  const handleTyping = useCallback(() => {
    if (!isTyping) {
      setIsTyping(true);
      socketService.sendTyping(room.id);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socketService.sendStopTyping(room.id);
    }, 2000);
  }, [room.id, isTyping]);

  // Send text message
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isSending) return;

    const content = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socketService.sendStopTyping(room.id);
    setIsTyping(false);

    try {
      await sendMessage(content, 'text');
    } catch (err) {
      console.error('Failed to send message:', err);
      setInputValue(content);
      setError('Failed to send message');
    } finally {
      setIsSending(false);
    }
  }, [inputValue, isSending, room.id, sendMessage]);

  // Handle file upload
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('Only images are allowed (JPEG, PNG, GIF, WebP)');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('File size must be less than 10MB');
      return;
    }

    setIsUploading(true);
    setUploadProgress('Uploading...');

    let uploadedKey: string | null = null;

    try {
      const uploadResult = await api.uploadFile(file, 'messages');

      if (!uploadResult.success || !uploadResult.data) {
        throw new Error(uploadResult.error || 'Upload failed');
      }

      uploadedKey = uploadResult.data.key;
      setUploadProgress('Encrypting...');

      const caption = file.name;

      try {
        await sendMessage(caption, 'image', uploadResult.data.url, file.type);
      } catch (sendError) {
        if (uploadedKey) {
          try {
            await api.deleteFile(uploadedKey);
          } catch (cleanupError) {
            console.error('Failed to cleanup orphaned file:', cleanupError);
          }
        }
        throw sendError;
      }
    } catch (err) {
      console.error('Failed to upload image:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  }, [sendMessage]);

  // Handle Enter key
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Format message time
  const formatMessageTime = useCallback((timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  // Format date divider
  const formatDateDivider = useCallback((timestamp: string): string => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }, []);

  // Render message content
  const renderMessageContent = useCallback((message: Message, isOwn: boolean) => {
    if (message.type === 'image' && message.mediaUrl) {
      return (
        <Box>
          <Box
            component="img"
            src={message.mediaUrl}
            alt={message.decryptedContent || 'Image'}
            onClick={() => setPreviewImage(message.mediaUrl!)}
            sx={{
              maxWidth: isMobile ? 200 : 250,
              maxHeight: isMobile ? 250 : 300,
              borderRadius: 1,
              cursor: 'pointer',
              display: 'block',
              '&:hover': { opacity: 0.9 },
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          {message.decryptedContent && message.decryptedContent !== '[Decrypting...]' && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.5,
                opacity: 0.8,
                fontStyle: 'italic',
              }}
            >
              {message.decryptedContent}
            </Typography>
          )}
        </Box>
      );
    }

    return (
      <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>
        {message.decryptedContent || '[Decrypting...]'}
      </Typography>
    );
  }, [isMobile]);

  // Calculate responsive widths
  const maxMessageWidth = useMemo(() => {
    if (isXs) return '85%';
    if (isSm) return '75%';
    if (isLgUp) return '60%';
    return '70%';
  }, [isXs, isSm, isLgUp]);

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#f0f2f5',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: { xs: 1.5, sm: 2 },
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1, sm: 2 },
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {isMobile && onBack && (
          <IconButton onClick={onBack} edge="start" size={isXs ? 'small' : 'medium'}>
            <ArrowBack />
          </IconButton>
        )}

        <Avatar
          src={isGroup ? (room.photoUrl || undefined) : (otherUser?.photoUrl || undefined)}
          sx={{
            width: { xs: 38, sm: 45 },
            height: { xs: 38, sm: 45 },
            bgcolor: isGroup ? 'primary.main' : undefined,
          }}
        >
          {isGroup ? (
            <Group fontSize={isXs ? 'small' : 'medium'} />
          ) : (
            (otherUser?.name || room.name || '?')[0]?.toUpperCase()
          )}
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant={isXs ? 'body1' : 'subtitle1'}
            fontWeight="medium"
            noWrap
          >
            {isGroup ? room.name : (otherUser?.name || otherUser?.email || 'Chat')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {isGroup ? (
              <Typography variant="caption" color="text.secondary">
                {room.members.length} members
              </Typography>
            ) : otherUser ? (
              <>
                <Circle
                  sx={{
                    fontSize: 8,
                    color: otherUser.state === 'online' ? 'success.main' : 'text.disabled',
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {otherUser.state === 'online' ? 'Online' : 'Offline'}
                </Typography>
              </>
            ) : null}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
          {!isXs && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Lock sx={{ fontSize: { xs: 14, sm: 16 }, color: 'success.main' }} />
              <Typography variant="caption" color="success.main" sx={{ display: { xs: 'none', sm: 'block' } }}>
                E2E Encrypted
              </Typography>
            </Box>
          )}
          {isGroup && (
            <IconButton onClick={() => setGroupInfoOpen(true)} size={isXs ? 'small' : 'medium'}>
              <Info fontSize={isXs ? 'small' : 'medium'} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Messages */}
      {isLoadingMessages && messages.length === 0 ? (
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <MessageListSkeleton count={10} />
        </Box>
      ) : (
        <VirtualizedMessageList
          messages={messages}
          currentUserId={user?.id}
          isLoading={isLoadingMessages}
          hasMore={hasMoreMessages}
          onLoadMore={loadMoreMessages}
          typingUsers={roomTypingUsers}
          renderMessageContent={renderMessageContent}
          formatMessageTime={formatMessageTime}
          formatDateDivider={formatDateDivider}
        />
      )}

      {/* Upload progress */}
      {isUploading && (
        <Box
          sx={{
            p: 1,
            bgcolor: 'primary.light',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <CircularProgress size={16} sx={{ color: 'white' }} />
          <Typography variant="caption" sx={{ color: 'white' }}>
            {uploadProgress}
          </Typography>
        </Box>
      )}

      {/* Input */}
      <Box
        sx={{
          p: { xs: 1, sm: 2 },
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 0.5, sm: 1 } }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept={ALLOWED_IMAGE_TYPES.join(',')}
            style={{ display: 'none' }}
          />

          <IconButton
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending || isUploading}
            color="primary"
            size={isXs ? 'small' : 'medium'}
          >
            <ImageIcon fontSize={isXs ? 'small' : 'medium'} />
          </IconButton>

          <TextField
            fullWidth
            multiline
            maxRows={4}
            placeholder="Type a message..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              handleTyping();
            }}
            onKeyPress={handleKeyPress}
            disabled={isUploading}
            size={isXs ? 'small' : 'medium'}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    color="primary"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isSending || isUploading}
                    size={isXs ? 'small' : 'medium'}
                  >
                    {isSending ? (
                      <CircularProgress size={isXs ? 18 : 24} />
                    ) : (
                      <Send fontSize={isXs ? 'small' : 'medium'} />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: { xs: 2, sm: 3 },
              },
            }}
          />
        </Box>
      </Box>

      {/* Image preview dialog */}
      <Dialog
        open={!!previewImage}
        onClose={() => setPreviewImage(null)}
        maxWidth="lg"
        fullScreen={isXs}
      >
        <DialogContent sx={{ p: 0, position: 'relative' }}>
          <IconButton
            onClick={() => setPreviewImage(null)}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            }}
          >
            <Close />
          </IconButton>
          {previewImage && (
            <Box
              component="img"
              src={previewImage}
              alt="Preview"
              sx={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                display: 'block',
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Error snackbar */}
      <Snackbar
        open={!!error}
        autoHideDuration={5000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setError(null)} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>

      {/* Group info panel */}
      {isGroup && (
        <GroupInfoPanel
          open={groupInfoOpen}
          onClose={() => setGroupInfoOpen(false)}
          room={room}
        />
      )}
    </Box>
  );
};

export default ChatWindow;
