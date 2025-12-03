'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { Message } from '@/types';

interface SystemMessageProps {
  message: Message;
}

export default function SystemMessage({ message }: SystemMessageProps) {
  const getText = (): string => {
    const data = message.systemEventData;

    switch (message.systemEventType) {
      case 'member_added':
        return `${data?.actorName} added ${data?.targetName}`;
      case 'member_removed':
        return `${data?.actorName} removed ${data?.targetName}`;
      case 'member_left':
        return `${data?.actorName} left the group`;
      case 'admin_promoted':
        return `${data?.actorName} made ${data?.targetName} an admin`;
      case 'admin_demoted':
        return `${data?.actorName} removed ${data?.targetName} as admin`;
      case 'group_created':
        return `${data?.actorName} created this group`;
      case 'group_name_changed':
        return `${data?.actorName} changed the group name to "${data?.newValue}"`;
      case 'group_photo_changed':
        return `${data?.actorName} changed the group photo`;
      default:
        return message.decryptedContent || 'System message';
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        my: 2,
        px: 2,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          bgcolor: 'action.hover',
          px: 2,
          py: 0.5,
          borderRadius: 1,
          color: 'text.secondary',
        }}
      >
        {getText()}
      </Typography>
    </Box>
  );
}
