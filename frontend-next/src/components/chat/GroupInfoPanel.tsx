'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Avatar,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Menu,
  MenuItem,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupIcon from '@mui/icons-material/Group';
import StarIcon from '@mui/icons-material/Star';
import { Room, RoomMember } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import AddMemberDialog from './AddMemberDialog';

interface GroupInfoPanelProps {
  room: Room;
  onClose: () => void;
}

export default function GroupInfoPanel({ room, onClose }: GroupInfoPanelProps) {
  const { user } = useAuth();
  const { removeMember, promoteMember, demoteMember, leaveRoom, deleteGroup, getUserRole } =
    useChat();

  const [memberMenuAnchor, setMemberMenuAnchor] = useState<{
    element: HTMLElement;
    member: RoomMember;
  } | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isGroup = room.members.length > 2;
  const currentUserRole = getUserRole(room.id);
  const isAdmin = currentUserRole === 'admin';

  const getRoomName = (): string => {
    if (room.name) return room.name;
    const otherMember = room.members.find((m) => m.id !== user?.id);
    return otherMember?.name || otherMember?.email || 'Unknown';
  };

  const handleMemberAction = async (action: string) => {
    if (!memberMenuAnchor) return;
    const { member } = memberMenuAnchor;
    setMemberMenuAnchor(null);
    setIsLoading(true);

    try {
      switch (action) {
        case 'remove':
          await removeMember(room.id, member.id);
          break;
        case 'promote':
          await promoteMember(room.id, member.id);
          break;
        case 'demote':
          await demoteMember(room.id, member.id);
          break;
      }
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeave = async () => {
    setShowLeaveConfirm(false);
    setIsLoading(true);
    try {
      await leaveRoom(room.id);
      onClose();
    } catch (error) {
      console.error('Failed to leave:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setIsLoading(true);
    try {
      await deleteGroup(room.id);
      onClose();
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box
      sx={{
        width: 320,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid',
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
        <Typography variant="subtitle1" fontWeight={600}>
          {isGroup ? 'Group Info' : 'Chat Info'}
        </Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider />

      {/* Room Info */}
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Avatar
          src={room.photoUrl || undefined}
          sx={{ width: 80, height: 80, mx: 'auto', mb: 2 }}
        >
          {isGroup ? <GroupIcon sx={{ fontSize: 40 }} /> : getRoomName()[0]}
        </Avatar>
        <Typography variant="h6">{getRoomName()}</Typography>
        <Typography variant="body2" color="text.secondary">
          {room.members.length} member{room.members.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      <Divider />

      {/* Members */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="subtitle2" color="text.secondary">
            Members
          </Typography>
          {isGroup && isAdmin && (
            <IconButton size="small" onClick={() => setShowAddMember(true)}>
              <PersonAddIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        <List dense>
          {room.members.map((member) => (
            <ListItem key={member.id}>
              <ListItemAvatar>
                <Avatar src={member.photoUrl || undefined}>
                  {member.name?.[0] || member.email[0]}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {member.name || member.email}
                    {member.id === user?.id && (
                      <Typography variant="caption" color="text.secondary">
                        (You)
                      </Typography>
                    )}
                    {member.role === 'admin' && (
                      <StarIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                    )}
                  </Box>
                }
                secondary={member.email}
              />
              {isGroup && isAdmin && member.id !== user?.id && (
                <ListItemSecondaryAction>
                  <IconButton
                    size="small"
                    onClick={(e) =>
                      setMemberMenuAnchor({ element: e.currentTarget, member })
                    }
                    disabled={isLoading}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              )}
            </ListItem>
          ))}
        </List>
      </Box>

      {/* Actions */}
      {isGroup && (
        <Box sx={{ p: 2 }}>
          <Button
            fullWidth
            variant="outlined"
            color="error"
            startIcon={<ExitToAppIcon />}
            onClick={() => setShowLeaveConfirm(true)}
            disabled={isLoading}
            sx={{ mb: 1 }}
          >
            Leave Group
          </Button>
          {isAdmin && (
            <Button
              fullWidth
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isLoading}
            >
              Delete Group
            </Button>
          )}
        </Box>
      )}

      {/* Member Menu */}
      <Menu
        anchorEl={memberMenuAnchor?.element}
        open={Boolean(memberMenuAnchor)}
        onClose={() => setMemberMenuAnchor(null)}
      >
        {memberMenuAnchor?.member.role === 'member' ? (
          <MenuItem onClick={() => handleMemberAction('promote')}>
            Make Admin
          </MenuItem>
        ) : (
          <MenuItem onClick={() => handleMemberAction('demote')}>
            Remove Admin
          </MenuItem>
        )}
        <MenuItem onClick={() => handleMemberAction('remove')}>Remove</MenuItem>
      </Menu>

      {/* Add Member Dialog */}
      <AddMemberDialog
        open={showAddMember}
        onClose={() => setShowAddMember(false)}
        roomId={room.id}
        existingMemberIds={room.members.map((m) => m.id)}
      />

      {/* Leave Confirmation */}
      <Dialog open={showLeaveConfirm} onClose={() => setShowLeaveConfirm(false)}>
        <DialogTitle>Leave Group?</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to leave this group?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowLeaveConfirm(false)}>Cancel</Button>
          <Button onClick={handleLeave} color="error">
            Leave
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <DialogTitle>Delete Group?</DialogTitle>
        <DialogContent>
          <Typography>
            This will permanently delete the group and all messages. This action cannot be
            undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
