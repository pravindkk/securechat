/**
 * Virtualized Message List Component
 *
 * Uses @tanstack/react-virtual for efficient rendering of large message lists.
 * Only renders visible messages plus a buffer, dramatically improving performance.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, Typography, Paper, CircularProgress } from '@mui/material';
import { Message } from '../../types';
import SystemMessage from './SystemMessage';

interface VirtualizedMessageListProps {
  messages: Message[];
  currentUserId?: string;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  typingUsers: string[];
  renderMessageContent: (message: Message, isOwn: boolean) => React.ReactNode;
  formatMessageTime: (timestamp: string) => string;
  formatDateDivider: (timestamp: string) => string;
}

const VirtualizedMessageList: React.FC<VirtualizedMessageListProps> = ({
  messages,
  currentUserId,
  isLoading,
  hasMore,
  onLoadMore,
  typingUsers,
  renderMessageContent,
  formatMessageTime,
  formatDateDivider,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const isLoadingMore = useRef(false);
  const prevMessagesLength = useRef(messages.length);

  // Create items array with date dividers
  const items = React.useMemo(() => {
    const result: Array<{ type: 'date' | 'message'; data: Message | string; index: number }> = [];
    let lastDate = '';

    messages.forEach((message, index) => {
      const messageDate = new Date(message.timestamp).toDateString();
      if (messageDate !== lastDate) {
        result.push({ type: 'date', data: message.timestamp, index: result.length });
        lastDate = messageDate;
      }
      result.push({ type: 'message', data: message, index: result.length });
    });

    return result;
  }, [messages]);

  // Estimate item height based on type
  const estimateSize = useCallback((index: number) => {
    const item = items[index];
    if (!item) return 60;
    if (item.type === 'date') return 50;

    const message = item.data as Message;
    if (message.type === 'system') return 40;
    if (message.type === 'image') return 320;

    // Estimate based on content length
    const contentLength = message.decryptedContent?.length || 0;
    const lines = Math.ceil(contentLength / 40);
    return Math.max(60, 40 + lines * 20);
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 10,
    getItemKey: (index) => {
      const item = items[index];
      if (item.type === 'date') return `date-${item.data}`;
      return (item.data as Message)._id;
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      const isAtBottom = parentRef.current
        ? parentRef.current.scrollTop + parentRef.current.clientHeight >=
          parentRef.current.scrollHeight - 100
        : true;

      if (isAtBottom) {
        // Scroll to bottom for new messages
        setTimeout(() => {
          virtualizer.scrollToIndex(items.length - 1, { align: 'end', behavior: 'smooth' });
        }, 50);
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length, items.length, virtualizer]);

  // Load more when scrolling to top
  const handleScroll = useCallback(async () => {
    if (!parentRef.current || isLoadingMore.current || !hasMore || isLoading) return;

    const { scrollTop } = parentRef.current;
    if (scrollTop < 100) {
      isLoadingMore.current = true;
      const prevScrollHeight = parentRef.current.scrollHeight;

      await onLoadMore();

      // Maintain scroll position after loading more
      setTimeout(() => {
        if (parentRef.current) {
          const newScrollHeight = parentRef.current.scrollHeight;
          parentRef.current.scrollTop = newScrollHeight - prevScrollHeight;
        }
        isLoadingMore.current = false;
      }, 50);
    }
  }, [hasMore, isLoading, onLoadMore]);

  // Render a single virtual item
  const renderItem = (index: number) => {
    const item = items[index];
    if (!item) return null;

    if (item.type === 'date') {
      return (
        <Box sx={{ textAlign: 'center', py: 2 }}>
          <Typography
            variant="caption"
            sx={{
              bgcolor: 'rgba(0,0,0,0.1)',
              px: 2,
              py: 0.5,
              borderRadius: 2,
            }}
          >
            {formatDateDivider(item.data as string)}
          </Typography>
        </Box>
      );
    }

    const message = item.data as Message;
    const isOwn = message.senderId === currentUserId;

    if (message.type === 'system') {
      return <SystemMessage message={message} currentUserId={currentUserId} />;
    }

    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: isOwn ? 'flex-end' : 'flex-start',
          mb: 0.5,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            maxWidth: '70%',
            bgcolor: isOwn ? 'primary.main' : 'background.paper',
            color: isOwn ? 'white' : 'text.primary',
            borderRadius: 2,
            borderTopRightRadius: isOwn ? 0 : 2,
            borderTopLeftRadius: isOwn ? 2 : 0,
            opacity: message.pending ? 0.7 : 1,
          }}
        >
          {renderMessageContent(message, isOwn)}
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              textAlign: 'right',
              mt: 0.5,
              opacity: 0.7,
            }}
          >
            {formatMessageTime(message.timestamp)}
            {message.pending && ' (sending...)'}
            {message.failed && ' (failed)'}
          </Typography>
        </Paper>
      </Box>
    );
  };

  return (
    <Box
      ref={parentRef}
      onScroll={handleScroll}
      sx={{
        flex: 1,
        overflow: 'auto',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Load more indicator */}
      {hasMore && (
        <Box sx={{ textAlign: 'center', py: 1 }}>
          {isLoading ? (
            <CircularProgress size={20} />
          ) : (
            <Typography
              variant="caption"
              color="primary"
              sx={{ cursor: 'pointer' }}
              onClick={onLoadMore}
            >
              Load earlier messages
            </Typography>
          )}
        </Box>
      )}

      {/* Virtualized list container */}
      <Box
        sx={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <Box
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(virtualItem.index)}
          </Box>
        ))}
      </Box>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, mt: 'auto' }}>
          <Typography variant="caption" color="text.secondary">
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default VirtualizedMessageList;
