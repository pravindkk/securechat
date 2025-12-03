'use client';

import React, { useState } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Badge,
  IconButton,
  TextField,
  InputAdornment,
  Divider,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ChatIcon from '@mui/icons-material/Chat';
import GroupIcon from '@mui/icons-material/Group';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import LogoutIcon from '@mui/icons-material/Logout';
import { Chat, Room } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';

interface SidebarProps {
  onNewChat: () => void;
  onNewGroup: () => void;
}

export default function Sidebar({ onNewChat, onNewGroup }: SidebarProps) {
  const { user, logout } = useAuth();
  const { chats, currentRoom, setCurrentRoom, isLoadingChats, isGroupChat } = useChat();

  const [searchQuery, setSearchQuery] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const filteredChats = chats.filter((chat) => {
    if (!searchQuery) return true;
    const name = chat.name || chat.otherUser?.name || chat.otherUser?.email || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleChatSelect = async (chat: Chat) => {
    const room: Room = {
      id: chat.id,
      name: chat.name,
      isPrivate: chat.isPrivate,
      photoUrl: chat.photoUrl,
      createdAt: '',
      updatedAt: '',
      members: chat.members,
    };
    setCurrentRoom(room);
  };

  const getChatName = (chat: Chat): string => {
    if (chat.name) return chat.name;
    if (chat.otherUser) return chat.otherUser.name || chat.otherUser.email;
    return 'Unknown';
  };

  const getChatAvatar = (chat: Chat): string | undefined => {
    if (chat.photoUrl) return chat.photoUrl;
    if (chat.otherUser?.photoUrl) return chat.otherUser.photoUrl;
    return undefined;
  };

  const formatTime = (dateString: string | null): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <Box
      sx={{
        width: 320,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Avatar src={user?.photoUrl || undefined} sx={{ width: 40, height: 40 }}>
            {user?.name?.[0] || user?.email?.[0]}
          </Avatar>
          <Typography variant="subtitle1" fontWeight={600}>
            {user?.name || user?.email}
          </Typography>
        </Box>
        <Box>
          <Tooltip title="New Chat">
            <IconButton onClick={onNewChat} size="small">
              <ChatIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="New Group">
            <IconButton onClick={onNewGroup} size="small">
              <GroupIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} size="small">
            <MoreVertIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Search */}
      <Box sx={{ px: 2, pb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Divider />

      {/* Chat List */}
      <List sx={{ flex: 1, overflow: 'auto', p: 0 }}>
        {isLoadingChats ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography color="text.secondary">Loading...</Typography>
          </Box>
        ) : filteredChats.length === 0 ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {searchQuery ? 'No chats found' : 'No chats yet'}
            </Typography>
          </Box>
        ) : (
          filteredChats.map((chat) => (
            <ListItem
              key={chat.id}
              onClick={() => handleChatSelect(chat)}
              sx={{
                cursor: 'pointer',
                bgcolor: currentRoom?.id === chat.id ? 'action.selected' : 'transparent',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <ListItemAvatar>
                <Badge
                  overlap="circular"
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  variant="dot"
                  color={chat.otherUser?.state === 'online' ? 'success' : 'default'}
                  invisible={!chat.otherUser || chat.otherUser.state !== 'online'}
                >
                  <Avatar src={getChatAvatar(chat)}>
                    {isGroupChat(chat) ? <GroupIcon /> : getChatName(chat)[0]}
                  </Avatar>
                </Badge>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      noWrap
                      sx={{ maxWidth: 150, fontWeight: 500 }}
                    >
                      {getChatName(chat)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatTime(chat.lastMessageAt)}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      sx={{ maxWidth: 180 }}
                    >
                      {chat.lastMessagePreview || 'No messages yet'}
                    </Typography>
                    {chat.unreadCount > 0 && (
                      <Badge
                        badgeContent={chat.unreadCount}
                        color="primary"
                        max={99}
                        sx={{ ml: 1 }}
                      />
                    )}
                  </Box>
                }
              />
            </ListItem>
          ))
        )}
      </List>

      {/* Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            logout();
          }}
        >
          <LogoutIcon sx={{ mr: 1 }} fontSize="small" />
          Logout
        </MenuItem>
      </Menu>
    </Box>
  );
}
