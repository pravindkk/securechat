import React from 'react';
import { Box, Typography } from '@mui/material';
import { Lock, Security, Devices } from '@mui/icons-material';

const EmptyState: React.FC = () => {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'grey.50',
        p: 4,
      }}
    >
      <Box
        sx={{
          width: 100,
          height: 100,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 3,
        }}
      >
        <Lock sx={{ fontSize: 50, color: 'white' }} />
      </Box>
      <Typography variant="h5" fontWeight="bold" gutterBottom>
        Secure Chat
      </Typography>
      <Typography color="text.secondary" textAlign="center" maxWidth={400} sx={{ mb: 4 }}>
        Select a conversation or start a new one. All your messages are end-to-end encrypted.
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center', maxWidth: 150 }}>
          <Security sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
          <Typography variant="subtitle2" fontWeight="medium">
            TLS 1.3 Style
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Military-grade encryption
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'center', maxWidth: 150 }}>
          <Devices sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
          <Typography variant="subtitle2" fontWeight="medium">
            Multi-Device
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Access from anywhere
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'center', maxWidth: 150 }}>
          <Lock sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
          <Typography variant="subtitle2" fontWeight="medium">
            OTP-Only Auth
          </Typography>
          <Typography variant="caption" color="text.secondary">
            No passwords needed
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default EmptyState;
