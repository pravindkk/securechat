'use client';

import { Box, CircularProgress } from '@mui/material';

export default function LoadingScreen() {
  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <CircularProgress sx={{ color: 'white' }} />
    </Box>
  );
}
