'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';

export default function EmptyState() {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          bgcolor: 'primary.light',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 2,
        }}
      >
        <ChatIcon sx={{ fontSize: 40, color: 'primary.main' }} />
      </Box>
      <Typography variant="h6" gutterBottom>
        Welcome to SecureChat
      </Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center">
        Select a chat or start a new conversation
        <br />
        Your messages are end-to-end encrypted
      </Typography>
    </Box>
  );
}
