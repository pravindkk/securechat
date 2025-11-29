/**
 * ChatContext - Backward Compatibility Layer
 *
 * This file re-exports from the new split contexts for backward compatibility.
 * New code should import from ChatProviders or the individual contexts directly.
 *
 * @deprecated Use ChatProviders and individual context hooks instead
 */

// Re-export ChatProviders as ChatProvider for backward compatibility
export { ChatProviders as ChatProvider, useChat } from './ChatProviders';

// Also export individual hooks for granular access
export { useRooms } from './RoomsContext';
export { useMessages } from './MessagesContext';
export { useGroup } from './GroupContext';
export { useEncryption } from './EncryptionContext';

// Default export for backward compatibility
export { ChatProviders as default } from './ChatProviders';
