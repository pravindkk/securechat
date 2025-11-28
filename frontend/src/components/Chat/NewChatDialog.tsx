import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  CircularProgress,
  Typography,
  Box,
  InputAdornment,
} from '@mui/material';
import { Search, Person } from '@mui/icons-material';
import { api } from '../../services/api';
import { useChat } from '../../contexts/ChatContext';
import { User } from '../../types';

interface NewChatDialogProps {
  open: boolean;
  onClose: () => void;
}

const NewChatDialog: React.FC<NewChatDialogProps> = ({ open, onClose }) => {
  const { createRoom, setCurrentRoom } = useChat();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setError('');

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await api.searchUsers(query);
      if (response.success && response.data) {
        setSearchResults(response.data.users);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectUser = async (user: User) => {
    setIsCreating(true);
    setError('');

    try {
      const room = await createRoom(true, [user.id]);
      setCurrentRoom(room);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setSearchResults([]);
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Conversation</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
          margin="dense"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
            endAdornment: isSearching && <CircularProgress size={20} />,
          }}
        />

        {error && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}

        {searchResults.length > 0 ? (
          <List sx={{ mt: 1 }}>
            {searchResults.map((user) => (
              <ListItem
                key={user.id}
                button
                onClick={() => handleSelectUser(user)}
                disabled={isCreating}
              >
                <ListItemAvatar>
                  <Avatar src={user.photoUrl || undefined}>
                    <Person />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={user.name || user.email}
                  secondary={user.email}
                />
              </ListItem>
            ))}
          </List>
        ) : searchQuery.length >= 2 && !isSearching ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography color="text.secondary">No users found</Typography>
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography color="text.secondary">
              Search for users to start a conversation
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isCreating}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewChatDialog;
