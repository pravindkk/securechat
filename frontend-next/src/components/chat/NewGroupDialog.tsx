'use client';

import React, { useState, useEffect } from 'react';
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
  ListItemSecondaryAction,
  Avatar,
  Typography,
  CircularProgress,
  Box,
  Chip,
  InputAdornment,
  Checkbox,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '@/services/api';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/hooks/useAuth';
import { User } from '@/types';

interface NewGroupDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function NewGroupDialog({ open, onClose }: NewGroupDialogProps) {
  const { user } = useAuth();
  const { createGroupRoom, setCurrentRoom } = useChat();

  const [step, setStep] = useState<'members' | 'details'>('members');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep('members');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedUsers([]);
      setGroupName('');
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
          setSearchResults(response.data.filter((u: any) => u.id !== user?.id));
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

  const handleToggleUser = (selectedUser: User) => {
    if (selectedUsers.some((u) => u.id === selectedUser.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== selectedUser.id));
    } else {
      setSelectedUsers([...selectedUsers, selectedUser]);
    }
  };

  const handleNext = () => {
    if (selectedUsers.length >= 1) {
      setStep('details');
    }
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selectedUsers.length < 1) return;

    setIsCreating(true);
    try {
      const room = await createGroupRoom(
        selectedUsers.map((u) => u.id),
        groupName.trim()
      );
      setCurrentRoom(room);
      onClose();
    } catch (error) {
      console.error('Failed to create group:', error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {step === 'members' ? 'Select Members' : 'Group Details'}
      </DialogTitle>
      <DialogContent>
        {step === 'members' ? (
          <>
            <TextField
              fullWidth
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />

            {selectedUsers.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {selectedUsers.map((u) => (
                  <Chip
                    key={u.id}
                    label={u.name || u.email}
                    onDelete={() => handleToggleUser(u)}
                    size="small"
                  />
                ))}
              </Box>
            )}

            {isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : searchResults.length === 0 ? (
              <Typography color="text.secondary" textAlign="center">
                {searchQuery ? 'No users found' : 'Search for users to add to the group'}
              </Typography>
            ) : (
              <List>
                {searchResults.map((result) => (
                  <ListItem
                    key={result.id}
                    onClick={() => handleToggleUser(result)}
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
                    <ListItemSecondaryAction>
                      <Checkbox
                        checked={selectedUsers.some((u) => u.id === result.id)}
                        onChange={() => handleToggleUser(result)}
                      />
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        ) : (
          <>
            <TextField
              fullWidth
              label="Group Name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
              sx={{ mb: 2 }}
            />
            <Typography variant="body2" color="text.secondary">
              {selectedUsers.length} member{selectedUsers.length !== 1 ? 's' : ''} selected
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {step === 'members' ? (
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={selectedUsers.length < 1}
          >
            Next
          </Button>
        ) : (
          <>
            <Button onClick={() => setStep('members')}>Back</Button>
            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={!groupName.trim() || isCreating}
            >
              {isCreating ? <CircularProgress size={20} /> : 'Create Group'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
