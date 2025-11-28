import React, { useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Avatar,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Button,
  Menu,
  MenuItem,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  Close,
  Group,
  Edit,
  PersonAdd,
  MoreVert,
  AdminPanelSettings,
  Person,
  ExitToApp,
  Delete,
} from '@mui/icons-material';
import { Room, RoomMember } from '../../types';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import AddMemberDialog from './AddMemberDialog';

interface GroupInfoPanelProps {
  open: boolean;
  onClose: () => void;
  room: Room;
}

const GroupInfoPanel: React.FC<GroupInfoPanelProps> = ({ open, onClose, room }) => {
  const { user } = useAuth();
  const {
    removeMember,
    leaveRoom,
    promoteMember,
    demoteMember,
    updateGroup,
    deleteGroup,
    getUserRole,
  } = useChat();

  const [memberMenuAnchor, setMemberMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedMember, setSelectedMember] = useState<RoomMember | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState(room.name || '');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<RoomMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentUserRole = getUserRole(room.id);
  const isAdmin = currentUserRole === 'admin';

  const handleMemberMenuOpen = (event: React.MouseEvent<HTMLElement>, member: RoomMember) => {
    setMemberMenuAnchor(event.currentTarget);
    setSelectedMember(member);
  };

  const handleMemberMenuClose = () => {
    setMemberMenuAnchor(null);
    setSelectedMember(null);
  };

  const handlePromote = async () => {
    if (!selectedMember) return;
    setIsLoading(true);
    setError(null);
    try {
      await promoteMember(room.id, selectedMember.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote member');
    } finally {
      setIsLoading(false);
      handleMemberMenuClose();
    }
  };

  const handleDemote = async () => {
    if (!selectedMember) return;
    setIsLoading(true);
    setError(null);
    try {
      await demoteMember(room.id, selectedMember.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to demote member');
    } finally {
      setIsLoading(false);
      handleMemberMenuClose();
    }
  };

  const handleRemoveClick = () => {
    if (!selectedMember) return;
    setMemberToRemove(selectedMember);
    setConfirmRemoveOpen(true);
    handleMemberMenuClose();
  };

  const handleRemove = async () => {
    if (!memberToRemove) return;
    setIsLoading(true);
    setError(null);
    try {
      await removeMember(room.id, memberToRemove.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setIsLoading(false);
      setConfirmRemoveOpen(false);
      setMemberToRemove(null);
    }
  };

  const handleLeave = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await leaveRoom(room.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
    } finally {
      setIsLoading(false);
      setConfirmLeaveOpen(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await deleteGroup(room.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
    } finally {
      setIsLoading(false);
      setConfirmDeleteOpen(false);
    }
  };

  const handleUpdateName = async () => {
    if (!newGroupName.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await updateGroup(room.id, { name: newGroupName.trim() });
      setEditNameOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group name');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose}>
        <Box sx={{ width: 320, p: 2 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Group Info</Typography>
            <IconButton onClick={onClose}>
              <Close />
            </IconButton>
          </Box>

          {/* Group Avatar and Name */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Avatar
              src={room.photoUrl || undefined}
              sx={{ width: 80, height: 80, mx: 'auto', mb: 1, bgcolor: 'primary.main' }}
            >
              <Group sx={{ fontSize: 40 }} />
            </Avatar>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6">{room.name}</Typography>
              {isAdmin && (
                <IconButton size="small" onClick={() => setEditNameOpen(true)}>
                  <Edit fontSize="small" />
                </IconButton>
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {room.members.length} members
            </Typography>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Add Member Button */}
          {isAdmin && (
            <Button
              fullWidth
              variant="outlined"
              startIcon={<PersonAdd />}
              onClick={() => setAddMemberOpen(true)}
              sx={{ mb: 2 }}
            >
              Add Member
            </Button>
          )}

          {/* Members List */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Members
          </Typography>
          <List dense>
            {room.members.map((member) => {
              const isSelf = member.id === user?.id;
              const isThisAdmin = member.role === 'admin';

              return (
                <ListItem key={member.id}>
                  <ListItemAvatar>
                    <Avatar src={member.photoUrl || undefined}>
                      <Person />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {member.name || member.email}
                        {isSelf && ' (You)'}
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {isThisAdmin && (
                          <>
                            <AdminPanelSettings sx={{ fontSize: 14 }} />
                            Admin
                          </>
                        )}
                      </Box>
                    }
                  />
                  {isAdmin && !isSelf && (
                    <ListItemSecondaryAction>
                      <IconButton
                        size="small"
                        onClick={(e) => handleMemberMenuOpen(e, member)}
                      >
                        <MoreVert />
                      </IconButton>
                    </ListItemSecondaryAction>
                  )}
                </ListItem>
              );
            })}
          </List>

          <Divider sx={{ my: 2 }} />

          {/* Leave/Delete Buttons */}
          <Button
            fullWidth
            color="error"
            variant="outlined"
            startIcon={<ExitToApp />}
            onClick={() => setConfirmLeaveOpen(true)}
            sx={{ mb: 1 }}
          >
            Leave Group
          </Button>

          {isAdmin && (
            <Button
              fullWidth
              color="error"
              variant="contained"
              startIcon={<Delete />}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete Group
            </Button>
          )}
        </Box>
      </Drawer>

      {/* Member Action Menu */}
      <Menu
        anchorEl={memberMenuAnchor}
        open={Boolean(memberMenuAnchor)}
        onClose={handleMemberMenuClose}
      >
        {selectedMember?.role === 'member' ? (
          <MenuItem onClick={handlePromote} disabled={isLoading}>
            <AdminPanelSettings sx={{ mr: 1 }} /> Make Admin
          </MenuItem>
        ) : (
          <MenuItem onClick={handleDemote} disabled={isLoading}>
            <Person sx={{ mr: 1 }} /> Remove Admin
          </MenuItem>
        )}
        <MenuItem onClick={handleRemoveClick} disabled={isLoading} sx={{ color: 'error.main' }}>
          <Delete sx={{ mr: 1 }} /> Remove from Group
        </MenuItem>
      </Menu>

      {/* Edit Name Dialog */}
      <Dialog open={editNameOpen} onClose={() => setEditNameOpen(false)}>
        <DialogTitle>Edit Group Name</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
            autoFocus
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditNameOpen(false)}>Cancel</Button>
          <Button
            onClick={handleUpdateName}
            variant="contained"
            disabled={isLoading || !newGroupName.trim()}
          >
            {isLoading ? <CircularProgress size={24} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Leave Dialog */}
      <Dialog open={confirmLeaveOpen} onClose={() => setConfirmLeaveOpen(false)}>
        <DialogTitle>Leave Group?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to leave this group? You will need to be added back by an admin to rejoin.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmLeaveOpen(false)}>Cancel</Button>
          <Button onClick={handleLeave} color="error" disabled={isLoading}>
            {isLoading ? <CircularProgress size={24} /> : 'Leave'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle>Delete Group?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this group? This action cannot be undone and all messages will be lost.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={isLoading}>
            {isLoading ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Remove Member Dialog */}
      <Dialog open={confirmRemoveOpen} onClose={() => setConfirmRemoveOpen(false)}>
        <DialogTitle>Remove Member?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to remove {memberToRemove?.name || memberToRemove?.email} from
            this group? They will need to be added back by an admin to rejoin.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoveOpen(false)}>Cancel</Button>
          <Button onClick={handleRemove} color="error" disabled={isLoading}>
            {isLoading ? <CircularProgress size={24} /> : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Member Dialog */}
      <AddMemberDialog
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        roomId={room.id}
        existingMemberIds={room.members.map((m) => m.id)}
      />

      {/* Error Snackbar */}
      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
};

export default GroupInfoPanel;
