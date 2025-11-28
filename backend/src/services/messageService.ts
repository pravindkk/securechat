import { Message, IMessage, SystemEventType, SystemEventData } from '../models/Message.js';
import { roomService } from './roomService.js';
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
  keyVersion?: number;
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

    // Get current room key version
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { roomKeyVersion: true },
    });

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
      keyVersion: data.keyVersion || room?.roomKeyVersion || 1,
      timestamp: new Date(),
    });

    // Update last message preview and increment unread counts
    const preview = this.getMessagePreview(data.type);
    await roomService.updateLastMessage(roomId, preview);
    await roomService.incrementUnreadCount(roomId, senderId);

    return message;
  }

  /**
   * Create a system message for group events
   */
  async createSystemMessage(
    roomId: string,
    eventType: SystemEventType,
    eventData: SystemEventData
  ): Promise<IMessage> {
    const message = await Message.create({
      roomId,
      senderId: 'system',
      type: 'system',
      encryptedContent: '', // System messages are not encrypted
      iv: '',
      authTag: '',
      systemEventType: eventType,
      systemEventData: eventData,
      timestamp: new Date(),
    });

    // Update last message preview
    const preview = this.getSystemMessagePreview(eventType, eventData);
    await roomService.updateLastMessage(roomId, preview);

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
   * Admins can delete any message in their groups, members can only delete their own
   */
  async deleteMessage(
    messageId: string,
    userId: string,
    roomId: string
  ): Promise<void> {
    const message = await Message.findById(messageId);

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    // Verify the message belongs to the specified room
    if (message.roomId !== roomId) {
      throw new ForbiddenError('Message does not belong to this room');
    }

    // Check if user is the sender
    if (message.senderId === userId) {
      await Message.findByIdAndDelete(messageId);
      return;
    }

    // Check if user is an admin of the room (for group chats)
    const isAdmin = await roomService.isAdmin(roomId, userId);
    if (!isAdmin) {
      throw new ForbiddenError('Can only delete your own messages');
    }

    // Admin can delete any message
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

  private getSystemMessagePreview(
    eventType: SystemEventType,
    eventData: SystemEventData
  ): string {
    const actorName = eventData.actorName || 'Someone';
    const targetName = eventData.targetName || 'a member';

    switch (eventType) {
      case 'member_added':
        return `${actorName} added ${targetName}`;
      case 'member_removed':
        return `${actorName} removed ${targetName}`;
      case 'member_left':
        return `${actorName} left the group`;
      case 'admin_promoted':
        return `${targetName} is now an admin`;
      case 'admin_demoted':
        return `${targetName} is no longer an admin`;
      case 'group_created':
        return `${actorName} created the group`;
      case 'group_name_changed':
        return `${actorName} changed the group name`;
      case 'group_photo_changed':
        return `${actorName} changed the group photo`;
      default:
        return 'Group updated';
    }
  }
}

export const messageService = new MessageService();
export default messageService;
