import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Avatar,
  Typography,
  CircularProgress,
  Paper,
  InputAdornment,
  Dialog,
  DialogContent,
  Snackbar,
  Alert,
} from '@mui/material';
import { 
  Send, 
  ArrowBack, 
  Circle, 
  Lock, 
  Image as ImageIcon,
  Close,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { Room, Message } from '../../types';
import { socketService } from '../../services/socket';
import { api } from '../../services/api';

interface ChatWindowProps {
  room: Room;
  onBack?: () => void;
  isMobile?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const ChatWindow: React.FC<ChatWindowProps> = ({ room, onBack, isMobile }) => {
  const { user } = useAuth();
  const { messages, isLoadingMessages, hasMoreMessages, typingUsers, sendMessage, loadMoreMessages } = useChat();
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  const otherUser = room.isPrivate
    ? room.members.find((m) => m.id !== user?.id)
    : null;

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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

  // Handle scroll for loading more messages
  const handleScroll = async () => {
    const container = messagesContainerRef.current;
    if (!container || isLoadingMessages || !hasMoreMessages) return;

    if (container.scrollTop === 0) {
      const prevScrollHeight = container.scrollHeight;
      await loadMoreMessages();
      setTimeout(() => {
        container.scrollTop = container.scrollHeight - prevScrollHeight;
      }, 0);
    }
  };

  // Typing indicator
  const handleTyping = () => {
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
  };

  // Handle text message send
  const handleSend = async () => {
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
  };

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Validate file
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
      // Upload file
      const uploadResult = await api.uploadFile(file, 'messages');
      
      if (!uploadResult.success || !uploadResult.data) {
        throw new Error(uploadResult.error || 'Upload failed');
      }

      uploadedKey = uploadResult.data.key;
      setUploadProgress('Encrypting...');

      // Send as image message
      // The caption/description is encrypted, mediaUrl is public
      const caption = file.name;
      
      try {
        await sendMessage(caption, 'image', uploadResult.data.url, file.type);
      } catch (sendError) {
        // Message send failed - clean up the orphaned uploaded file
        if (uploadedKey) {
          try {
            await api.deleteFile(uploadedKey);
            console.log('Cleaned up orphaned file:', uploadedKey);
          } catch (cleanupError) {
            console.error('Failed to cleanup orphaned file:', cleanupError);
          }
        }
        throw sendError;
      }

      setUploadProgress('');
    } catch (err) {
      console.error('Failed to upload image:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatMessageTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateDivider = (timestamp: string): string => {
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
  };

  const shouldShowDateDivider = (message: Message, index: number): boolean => {
    if (index === 0) return true;
    const prevMessage = messages[index - 1];
    const prevDate = new Date(prevMessage.timestamp).toDateString();
    const currDate = new Date(message.timestamp).toDateString();
    return prevDate !== currDate;
  };

  const roomTypingMap = typingUsers.get(room.id);
  const roomTypingUsers = roomTypingMap ? Array.from(roomTypingMap.values()) : [];

  // Render message content based on type
  const renderMessageContent = (message: Message, isOwn: boolean) => {
    if (message.type === 'image' && message.mediaUrl) {
      return (
        <Box>
          <Box
            component="img"
            src={message.mediaUrl}
            alt={message.decryptedContent || 'Image'}
            onClick={() => setPreviewImage(message.mediaUrl!)}
            sx={{
              maxWidth: 250,
              maxHeight: 300,
              borderRadius: 1,
              cursor: 'pointer',
              display: 'block',
              '&:hover': {
                opacity: 0.9,
              },
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
  };

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
          p: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {isMobile && onBack && (
          <IconButton onClick={onBack} edge="start">
            <ArrowBack />
          </IconButton>
        )}
        
        <Avatar
          src={otherUser?.photoUrl || undefined}
          sx={{ width: 45, height: 45 }}
        >
          {(otherUser?.name || room.name || '?')[0]?.toUpperCase()}
        </Avatar>
        
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            {otherUser?.name || otherUser?.email || room.name || 'Chat'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {otherUser && (
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
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Lock sx={{ fontSize: 16, color: 'success.main' }} />
          <Typography variant="caption" color="success.main">
            E2E Encrypted
          </Typography>
        </Box>
      </Box>

      {/* Messages */}
      <Box
        ref={messagesContainerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {isLoadingMessages && messages.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {hasMoreMessages && (
              <Box sx={{ textAlign: 'center', py: 1 }}>
                <Typography
                  variant="caption"
                  color="primary"
                  sx={{ cursor: 'pointer' }}
                  onClick={loadMoreMessages}
                >
                  Load earlier messages
                </Typography>
              </Box>
            )}
            
            {messages.map((message, index) => {
              const isOwn = message.senderId === user?.id;
              const showDateDivider = shouldShowDateDivider(message, index);

              return (
                <React.Fragment key={message._id}>
                  {showDateDivider && (
                    <Box sx={{ textAlign: 'center', py: 2 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          bgcolor: 'rgba(0,0,0,0.1)',
                          px: 2,
                          py: 0.5,
                          borderRadius: 2,
                        }}
                      >
                        {formatDateDivider(message.timestamp)}
                      </Typography>
                    </Box>
                  )}
                  
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: isOwn ? 'flex-end' : 'flex-start',
                      mb: 0.5,
                    }}
                  >
                    <Paper
                      elevation={0}
                      sx={{
                        p: 1.5,
                        maxWidth: '70%',
                        bgcolor: isOwn ? 'primary.main' : 'background.paper',
                        color: isOwn ? 'white' : 'text.primary',
                        borderRadius: 2,
                        borderTopRightRadius: isOwn ? 0 : 2,
                        borderTopLeftRadius: isOwn ? 2 : 0,
                      }}
                    >
                      {renderMessageContent(message, isOwn)}
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          textAlign: 'right',
                          mt: 0.5,
                          opacity: 0.7,
                        }}
                      >
                        {formatMessageTime(message.timestamp)}
                      </Typography>
                    </Paper>
                  </Box>
                </React.Fragment>
              );
            })}
          </>
        )}
        
        {/* Typing indicator */}
        {roomTypingUsers.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {roomTypingUsers.join(', ')} {roomTypingUsers.length === 1 ? 'is' : 'are'} typing...
            </Typography>
          </Box>
        )}
        
        <div ref={messagesEndRef} />
      </Box>

      {/* Upload progress indicator */}
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
          p: 2,
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept={ALLOWED_IMAGE_TYPES.join(',')}
            style={{ display: 'none' }}
          />
          
          {/* Attachment button */}
          <IconButton
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending || isUploading}
            color="primary"
          >
            <ImageIcon />
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
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    color="primary"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isSending || isUploading}
                  >
                    {isSending ? <CircularProgress size={24} /> : <Send />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 3,
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
    </Box>
  );
};

export default ChatWindow;
