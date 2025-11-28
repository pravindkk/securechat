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
import { Search, Person, PersonAdd } from '@mui/icons-material';
import { api } from '../../services/api';
import { useChat } from '../../contexts/ChatContext';
import { User } from '../../types';

interface AddMemberDialogProps {
  open: boolean;
  onClose: () => void;
  roomId: string;
  existingMemberIds: string[];
}

const AddMemberDialog: React.FC<AddMemberDialogProps> = ({
  open,
  onClose,
  roomId,
  existingMemberIds,
}) => {
  const { addMember } = useChat();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
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
        // Filter out existing members
        const filtered = response.data.users.filter(
          (u) => !existingMemberIds.includes(u.id)
        );
        setSearchResults(filtered);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddMember = async (user: User) => {
    setIsAdding(true);
    setError('');

    try {
      await addMember(roomId, user.id);
      // Remove from search results
      setSearchResults(searchResults.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setIsAdding(false);
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
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PersonAdd color="primary" />
          Add Member
        </Box>
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          placeholder="Search users to add..."
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
          <List sx={{ mt: 1, maxHeight: 300, overflow: 'auto' }}>
            {searchResults.map((user) => (
              <ListItem
                key={user.id}
                secondaryAction={
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => handleAddMember(user)}
                    disabled={isAdding}
                  >
                    Add
                  </Button>
                }
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
              Search for users to add to this group
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddMemberDialog;
