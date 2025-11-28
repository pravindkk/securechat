import React, { useState } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Avatar,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Badge,
  Menu,
  MenuItem,
  InputAdornment,
  CircularProgress,
  Fab,
} from '@mui/material';
import { Search, MoreVert, Logout, Add, Circle, Devices, Group, PersonAdd, GroupAdd } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { Chat, Room } from '../../types';
import NewChatDialog from './NewChatDialog';
import NewGroupDialog from './NewGroupDialog';

interface SidebarProps {
  onSelectChat: (room: Room) => void;
  selectedRoomId?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ onSelectChat, selectedRoomId }) => {
  const { user, logout } = useAuth();
  const { chats, isLoadingChats } = useChat();
  const [searchQuery, setSearchQuery] = useState('');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [fabAnchorEl, setFabAnchorEl] = useState<null | HTMLElement>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  const filteredChats = chats.filter((chat) => {
    const name = chat.isPrivate && chat.otherUser
      ? chat.otherUser.name || chat.otherUser.email
      : chat.name || 'Group Chat';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleMenuClose();
    await logout();
  };

  const getChatName = (chat: Chat): string => {
    if (chat.isPrivate && chat.otherUser) {
      return chat.otherUser.name || chat.otherUser.email;
    }
    return chat.name || 'Group Chat';
  };

  const getChatAvatar = (chat: Chat): string | undefined => {
    if (chat.isPrivate && chat.otherUser) {
      return chat.otherUser.photoUrl || undefined;
    }
    return chat.photoUrl || undefined;
  };

  const isOnline = (chat: Chat): boolean => {
    if (chat.isPrivate && chat.otherUser) {
      return chat.otherUser.state === 'online';
    }
    return false;
  };

  const isGroupChat = (chat: Chat): boolean => {
    return chat.members.length > 2 || (chat.name !== null && chat.otherUser === null);
  };

  const handleFabClick = (event: React.MouseEvent<HTMLElement>) => {
    setFabAnchorEl(event.currentTarget);
  };

  const handleFabClose = () => {
    setFabAnchorEl(null);
  };

  const handleNewChat = () => {
    handleFabClose();
    setNewChatOpen(true);
  };

  const handleNewGroup = () => {
    handleFabClose();
    setNewGroupOpen(true);
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
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

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
    onSelectChat(room);
  };

  return (
    <Box
      sx={{
        width: { xs: '100%', md: 350 },
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
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Avatar src={user?.photoUrl || undefined} sx={{ bgcolor: 'primary.main' }}>
            {user?.name?.charAt(0) || user?.email?.charAt(0)}
          </Avatar>
          <Box>
            <Typography variant="subtitle1" fontWeight="medium">
              {user?.name || user?.email}
            </Typography>
            <Typography variant="caption" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Circle sx={{ fontSize: 8 }} /> Online
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={handleMenuOpen}>
          <MoreVert />
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={handleMenuClose}>
            <Devices sx={{ mr: 1 }} /> Devices
          </MenuItem>
          <MenuItem onClick={handleLogout}>
            <Logout sx={{ mr: 1 }} /> Logout
          </MenuItem>
        </Menu>
      </Box>

      {/* Search */}
      <Box sx={{ p: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Chat List */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {isLoadingChats ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : filteredChats.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">
              {searchQuery ? 'No chats found' : 'No chats yet'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Start a new conversation!
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {filteredChats.map((chat) => (
              <ListItem
                key={chat.id}
                button
                selected={selectedRoomId === chat.id}
                onClick={() => handleChatSelect(chat)}
                sx={{
                  py: 1.5,
                  '&.Mui-selected': {
                    bgcolor: 'action.selected',
                  },
                }}
              >
                <ListItemAvatar>
                  <Badge
                    overlap="circular"
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    badgeContent={
                      isOnline(chat) ? (
                        <Circle sx={{ fontSize: 12, color: 'success.main' }} />
                      ) : null
                    }
                  >
                    <Avatar
                      src={getChatAvatar(chat)}
                      sx={isGroupChat(chat) ? { bgcolor: 'primary.main' } : undefined}
                    >
                      {isGroupChat(chat) ? (
                        <Group />
                      ) : (
                        getChatName(chat).charAt(0)
                      )}
                    </Avatar>
                  </Badge>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography
                        variant="subtitle2"
                        fontWeight={chat.unreadCount > 0 ? 'bold' : 'normal'}
                        noWrap
                        sx={{ maxWidth: 150 }}
                      >
                        {getChatName(chat)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatTime(chat.lastMessageAt)}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        sx={{ maxWidth: 180, fontWeight: chat.unreadCount > 0 ? 'medium' : 'normal' }}
                      >
                        {chat.lastMessagePreview || 'No messages yet'}
                      </Typography>
                      {chat.unreadCount > 0 && (
                        <Badge
                          badgeContent={chat.unreadCount}
                          color="primary"
                          sx={{ ml: 1 }}
                        />
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {/* New Chat FAB */}
      <Fab
        color="primary"
        size="medium"
        onClick={handleFabClick}
        sx={{
          position: 'absolute',
          bottom: 24,
          left: { xs: 'calc(50% - 28px)', md: 'calc(175px - 28px)' },
        }}
      >
        <Add />
      </Fab>

      {/* FAB Menu */}
      <Menu
        anchorEl={fabAnchorEl}
        open={Boolean(fabAnchorEl)}
        onClose={handleFabClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <MenuItem onClick={handleNewChat}>
          <PersonAdd sx={{ mr: 1 }} /> New Chat
        </MenuItem>
        <MenuItem onClick={handleNewGroup}>
          <GroupAdd sx={{ mr: 1 }} /> New Group
        </MenuItem>
      </Menu>

      <NewChatDialog open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      <NewGroupDialog open={newGroupOpen} onClose={() => setNewGroupOpen(false)} />
    </Box>
  );
};

export default Sidebar;
