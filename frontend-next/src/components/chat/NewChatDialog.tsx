'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  CircularProgress,
  Box,
  InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '@/services/api';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/hooks/useAuth';
import { User } from '@/types';

interface NewChatDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function NewChatDialog({ open, onClose }: NewChatDialogProps) {
  const { user } = useAuth();
  const { createRoom, setCurrentRoom } = useChat();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [open]);

  useEffect(() => {
    const search = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.searchUsers(searchQuery);
        if (response.success && response.data) {
          // Filter out current user
          setSearchResults(response.data.users.filter((u) => u.id !== user?.id));
        }
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, user?.id]);

  const handleSelectUser = async (selectedUser: User) => {
    setIsCreating(true);
    try {
      const room = await createRoom(true, [selectedUser.id]);
      setCurrentRoom(room);
      onClose();
    } catch (error) {
      console.error('Failed to create room:', error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Chat</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          sx={{ mb: 2 }}
        />

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : searchResults.length === 0 ? (
          <Typography color="text.secondary" textAlign="center">
            {searchQuery ? 'No users found' : 'Search for a user to start chatting'}
          </Typography>
        ) : (
          <List>
            {searchResults.map((result) => (
              <ListItem
                key={result.id}
                onClick={() => handleSelectUser(result)}
                disabled={isCreating}
                sx={{
                  cursor: 'pointer',
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <ListItemAvatar>
                  <Avatar src={result.photoUrl || undefined}>
                    {result.name?.[0] || result.email[0]}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={result.name || result.email}
                  secondary={result.name ? result.email : undefined}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
