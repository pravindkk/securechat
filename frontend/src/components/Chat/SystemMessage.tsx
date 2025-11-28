import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  PersonAdd,
  PersonRemove,
  ExitToApp,
  AdminPanelSettings,
  PersonOff,
  GroupAdd,
  Edit,
  Image as ImageIcon,
} from '@mui/icons-material';
import { Message, SystemEventType } from '../../types';

interface SystemMessageProps {
  message: Message;
  currentUserId?: string;
}

const getIcon = (eventType?: SystemEventType) => {
  const iconProps = { sx: { fontSize: 16, mr: 0.5 } };

  switch (eventType) {
    case 'member_added':
      return <PersonAdd {...iconProps} />;
    case 'member_removed':
      return <PersonRemove {...iconProps} />;
    case 'member_left':
      return <ExitToApp {...iconProps} />;
    case 'admin_promoted':
      return <AdminPanelSettings {...iconProps} />;
    case 'admin_demoted':
      return <PersonOff {...iconProps} />;
    case 'group_created':
      return <GroupAdd {...iconProps} />;
    case 'group_name_changed':
      return <Edit {...iconProps} />;
    case 'group_photo_changed':
      return <ImageIcon {...iconProps} />;
    default:
      return null;
  }
};

const formatSystemMessage = (
  eventType?: SystemEventType,
  eventData?: Message['systemEventData'],
  currentUserId?: string
): string => {
  if (!eventType || !eventData) {
    return 'System message';
  }

  const actorName = eventData.actorId === currentUserId ? 'You' : eventData.actorName;
  const targetName = eventData.targetId === currentUserId ? 'you' : eventData.targetName;

  switch (eventType) {
    case 'member_added':
      return `${actorName} added ${targetName}`;
    case 'member_removed':
      return `${actorName} removed ${targetName}`;
    case 'member_left':
      return `${actorName} left the group`;
    case 'admin_promoted':
      return `${targetName} ${eventData.targetId === currentUserId ? 'are' : 'is'} now an admin`;
    case 'admin_demoted':
      return `${targetName} ${eventData.targetId === currentUserId ? 'are' : 'is'} no longer an admin`;
    case 'group_created':
      return `${actorName} created this group`;
    case 'group_name_changed':
      if (eventData.oldValue && eventData.newValue) {
        return `${actorName} changed the group name from "${eventData.oldValue}" to "${eventData.newValue}"`;
      }
      return `${actorName} changed the group name to "${eventData.newValue}"`;
    case 'group_photo_changed':
      return `${actorName} changed the group photo`;
    default:
      return 'Group updated';
  }
};

const SystemMessage: React.FC<SystemMessageProps> = ({ message, currentUserId }) => {
  const text = formatSystemMessage(
    message.systemEventType,
    message.systemEventData,
    currentUserId
  );

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        my: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          bgcolor: 'rgba(0, 0, 0, 0.06)',
          px: 2,
          py: 0.75,
          borderRadius: 2,
        }}
      >
        {getIcon(message.systemEventType)}
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontStyle: 'italic',
          }}
        >
          {text}
        </Typography>
      </Box>
    </Box>
  );
};

export default SystemMessage;
