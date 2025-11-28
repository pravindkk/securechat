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
  Chip,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import { Search, Person, Group } from '@mui/icons-material';
import { api } from '../../services/api';
import { useChat } from '../../contexts/ChatContext';
import { User } from '../../types';

interface NewGroupDialogProps {
  open: boolean;
  onClose: () => void;
}

const NewGroupDialog: React.FC<NewGroupDialogProps> = ({ open, onClose }) => {
  const { createGroupRoom, setCurrentRoom } = useChat();
  const [activeStep, setActiveStep] = useState(0);
  const [groupName, setGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const steps = ['Add members', 'Group details'];

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
        // Filter out already selected users
        const filtered = response.data.users.filter(
          (u) => !selectedUsers.some((s) => s.id === u.id)
        );
        setSearchResults(filtered);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectUser = (user: User) => {
    if (selectedUsers.length >= 29) {
      setError('Maximum 29 members can be added (30 including you)');
      return;
    }
    setSelectedUsers([...selectedUsers, user]);
    setSearchResults(searchResults.filter((u) => u.id !== user.id));
    setSearchQuery('');
  };

  const handleRemoveUser = (userId: string) => {
    setSelectedUsers(selectedUsers.filter((u) => u.id !== userId));
  };

  const handleNext = () => {
    if (activeStep === 0 && selectedUsers.length === 0) {
      setError('Please add at least one member');
      return;
    }
    setError('');
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError('');
    setActiveStep((prev) => prev - 1);
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      setError('Please enter a group name');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const memberIds = selectedUsers.map((u) => u.id);
      const room = await createGroupRoom(memberIds, groupName.trim());
      setCurrentRoom(room);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setGroupName('');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedUsers([]);
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Group color="primary" />
          New Group
        </Box>
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 ? (
          <>
            {/* Selected users chips */}
            {selectedUsers.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {selectedUsers.map((user) => (
                  <Chip
                    key={user.id}
                    avatar={<Avatar src={user.photoUrl || undefined} />}
                    label={user.name || user.email}
                    onDelete={() => handleRemoveUser(user.id)}
                    size="small"
                  />
                ))}
              </Box>
            )}

            {/* Search input */}
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

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {selectedUsers.length}/29 members selected
            </Typography>

            {error && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                {error}
              </Typography>
            )}

            {/* Search results */}
            {searchResults.length > 0 ? (
              <List sx={{ mt: 1, maxHeight: 300, overflow: 'auto' }}>
                {searchResults.map((user) => (
                  <ListItem
                    key={user.id}
                    button
                    onClick={() => handleSelectUser(user)}
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
            ) : null}
          </>
        ) : (
          <>
            {/* Group name input */}
            <TextField
              fullWidth
              label="Group name"
              placeholder="Enter group name..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
              margin="dense"
              error={!!error}
              helperText={error}
            />

            {/* Selected members summary */}
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Members ({selectedUsers.length + 1})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              <Chip
                avatar={<Avatar><Person /></Avatar>}
                label="You (Admin)"
                size="small"
                color="primary"
              />
              {selectedUsers.map((user) => (
                <Chip
                  key={user.id}
                  avatar={<Avatar src={user.photoUrl || undefined} />}
                  label={user.name || user.email}
                  size="small"
                />
              ))}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isCreating}>
          Cancel
        </Button>
        {activeStep > 0 && (
          <Button onClick={handleBack} disabled={isCreating}>
            Back
          </Button>
        )}
        {activeStep < steps.length - 1 ? (
          <Button onClick={handleNext} variant="contained">
            Next
          </Button>
        ) : (
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={isCreating || !groupName.trim()}
          >
            {isCreating ? <CircularProgress size={24} /> : 'Create Group'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default NewGroupDialog;
