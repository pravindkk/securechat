/**
 * Skeleton Loader Components
 *
 * Provides loading state placeholders for better perceived performance.
 */

import React from 'react';
import { Box, Skeleton, Paper } from '@mui/material';

/**
 * Chat list item skeleton
 */
export const ChatListItemSkeleton: React.FC = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', p: 2, gap: 2 }}>
    <Skeleton variant="circular" width={50} height={50} />
    <Box sx={{ flex: 1 }}>
      <Skeleton variant="text" width="60%" height={24} />
      <Skeleton variant="text" width="80%" height={18} />
    </Box>
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <Skeleton variant="text" width={50} height={16} />
    </Box>
  </Box>
);

/**
 * Chat list skeleton (multiple items)
 */
export const ChatListSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <Box>
    {Array.from({ length: count }).map((_, i) => (
      <ChatListItemSkeleton key={i} />
    ))}
  </Box>
);

/**
 * Message skeleton (incoming message style)
 */
export const MessageSkeleton: React.FC<{ isOwn?: boolean }> = ({ isOwn = false }) => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: isOwn ? 'flex-end' : 'flex-start',
      mb: 1,
      px: 2,
    }}
  >
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        maxWidth: '70%',
        minWidth: 120,
        bgcolor: isOwn ? 'primary.light' : 'grey.100',
        borderRadius: 2,
        borderTopRightRadius: isOwn ? 0 : 2,
        borderTopLeftRadius: isOwn ? 2 : 0,
      }}
    >
      <Skeleton
        variant="text"
        width={isOwn ? 100 : 150}
        height={20}
        sx={{ bgcolor: isOwn ? 'primary.main' : 'grey.300' }}
      />
      <Skeleton
        variant="text"
        width={isOwn ? 80 : 120}
        height={16}
        sx={{ bgcolor: isOwn ? 'primary.main' : 'grey.300' }}
      />
    </Paper>
  </Box>
);

/**
 * Message list skeleton (conversation view)
 */
export const MessageListSkeleton: React.FC<{ count?: number }> = ({ count = 8 }) => {
  // Alternate between incoming and outgoing messages
  const pattern = [false, false, true, false, true, true, false, true];

  return (
    <Box sx={{ py: 2 }}>
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} isOwn={pattern[i % pattern.length]} />
      ))}
    </Box>
  );
};

/**
 * Chat window header skeleton
 */
export const ChatHeaderSkeleton: React.FC = () => (
  <Box
    sx={{
      p: 2,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      bgcolor: 'background.paper',
      borderBottom: '1px solid',
      borderColor: 'divider',
    }}
  >
    <Skeleton variant="circular" width={45} height={45} />
    <Box sx={{ flex: 1 }}>
      <Skeleton variant="text" width={120} height={24} />
      <Skeleton variant="text" width={80} height={16} />
    </Box>
    <Skeleton variant="rounded" width={100} height={24} />
  </Box>
);

/**
 * Group info panel skeleton
 */
export const GroupInfoSkeleton: React.FC = () => (
  <Box sx={{ p: 3 }}>
    {/* Group avatar and name */}
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
      <Skeleton variant="circular" width={80} height={80} sx={{ mb: 2 }} />
      <Skeleton variant="text" width={150} height={28} />
      <Skeleton variant="text" width={100} height={18} />
    </Box>

    {/* Members section */}
    <Skeleton variant="text" width={80} height={20} sx={{ mb: 1 }} />
    {Array.from({ length: 4 }).map((_, i) => (
      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
        <Skeleton variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width={100} height={20} />
          <Skeleton variant="text" width={60} height={14} />
        </Box>
      </Box>
    ))}
  </Box>
);

/**
 * User search result skeleton
 */
export const UserSearchSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <Box>
    {Array.from({ length: count }).map((_, i) => (
      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
        <Skeleton variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width={120} height={20} />
          <Skeleton variant="text" width={180} height={16} />
        </Box>
      </Box>
    ))}
  </Box>
);

/**
 * Full page loading skeleton
 */
export const PageLoadingSkeleton: React.FC = () => (
  <Box sx={{ display: 'flex', height: '100vh' }}>
    {/* Sidebar */}
    <Box sx={{ width: 350, borderRight: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Skeleton variant="circular" width={40} height={40} />
          <Skeleton variant="text" width={120} height={24} />
        </Box>
      </Box>
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rounded" width="100%" height={40} sx={{ mb: 2 }} />
      </Box>
      <ChatListSkeleton count={6} />
    </Box>

    {/* Main content */}
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <ChatHeaderSkeleton />
      <Box sx={{ flex: 1, bgcolor: '#f0f2f5' }}>
        <MessageListSkeleton count={10} />
      </Box>
      <Box sx={{ p: 2, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider' }}>
        <Skeleton variant="rounded" width="100%" height={50} />
      </Box>
    </Box>
  </Box>
);

export default {
  ChatListItemSkeleton,
  ChatListSkeleton,
  MessageSkeleton,
  MessageListSkeleton,
  ChatHeaderSkeleton,
  GroupInfoSkeleton,
  UserSearchSkeleton,
  PageLoadingSkeleton,
};
