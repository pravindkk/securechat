import { Message, IMessage } from '../models/Message.js';
import { roomService } from './roomService.js';
import { truncate } from '../utils/helpers.js';
import { NotFoundError, ForbiddenError } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';
import { PaginatedResponse } from '../types/index.js';

interface MessageData {
  encryptedContent: string;
  iv: string;
  authTag: string;
  type: 'text' | 'image' | 'audio' | 'system';
  mediaUrl?: string;
  mediaType?: string;
}

export class MessageService {
  /**
   * Create a new message
   */
  async createMessage(
    roomId: string,
    senderId: string,
    data: MessageData
  ): Promise<IMessage> {
    // Verify user is member of room
    const isMember = await roomService.isMember(roomId, senderId);
    if (!isMember) {
      throw new ForbiddenError('Not a member of this room');
    }

    // Create message
    const message = await Message.create({
      roomId,
      senderId,
      type: data.type,
      encryptedContent: data.encryptedContent,
      iv: data.iv,
      authTag: data.authTag,
      mediaUrl: data.mediaUrl,
      mediaType: data.mediaType,
      timestamp: new Date(),
    });

    // Update last message preview and increment unread counts
    const preview = this.getMessagePreview(data.type);
    await roomService.updateLastMessage(roomId, preview);
    await roomService.incrementUnreadCount(roomId, senderId);

    return message;
  }

  /**
   * Get messages for a room with pagination
   */
  async getMessages(
    roomId: string,
    userId: string,
    limit: number = 50,
    before?: string
  ): Promise<PaginatedResponse<IMessage>> {
    // Verify user is member of room
    const isMember = await roomService.isMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenError('Not a member of this room');
    }

    const query: any = { roomId };

    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, -1) : messages;

    // Get sender info for all messages
    const senderIds = [...new Set(items.map((m) => m.senderId))];
    const senders = await prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, photoUrl: true },
    });

    const senderMap = new Map(senders.map((s) => [s.id, s]));

    const messagesWithSender = items.map((m) => ({
      ...m,
      sender: senderMap.get(m.senderId) || null,
    }));

    return {
      items: messagesWithSender.reverse() as any,
      total: items.length,
      hasMore,
    };
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await Message.findById(messageId);

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenError('Can only delete your own messages');
    }

    await Message.findByIdAndDelete(messageId);
  }

  private getMessagePreview(type: string): string {
    switch (type) {
      case 'image':
        return '📷 Image';
      case 'audio':
        return '🎵 Audio';
      case 'system':
        return 'System message';
      default:
        return '[Encrypted message]';
    }
  }
}

export const messageService = new MessageService();
export default messageService;
