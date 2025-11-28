import mongoose, { Document, Schema } from 'mongoose';

// System event types for group chat events
export type SystemEventType =
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'admin_promoted'
  | 'admin_demoted'
  | 'group_created'
  | 'group_name_changed'
  | 'group_photo_changed';

export interface SystemEventData {
  actorId: string;
  actorName: string;
  targetId?: string;
  targetName?: string;
  oldValue?: string;
  newValue?: string;
}

export interface IMessage extends Document {
  roomId: string;
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'system';
  encryptedContent: string;
  iv: string;
  authTag: string;
  mediaUrl?: string;
  mediaType?: string;
  keyVersion?: number; // Which room key version encrypted this message
  systemEventType?: SystemEventType; // For system messages
  systemEventData?: SystemEventData; // Metadata for system events
  timestamp: Date;
  createdAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'audio', 'system'],
      default: 'text',
    },
    encryptedContent: {
      type: String,
      required: function(this: IMessage) { return this.type !== 'system'; },
    },
    iv: {
      type: String,
      required: function(this: IMessage) { return this.type !== 'system'; },
    },
    authTag: {
      type: String,
      required: function(this: IMessage) { return this.type !== 'system'; },
    },
    mediaUrl: {
      type: String,
    },
    mediaType: {
      type: String,
    },
    keyVersion: {
      type: Number,
      default: 1,
    },
    systemEventType: {
      type: String,
      enum: [
        'member_added',
        'member_removed',
        'member_left',
        'admin_promoted',
        'admin_demoted',
        'group_created',
        'group_name_changed',
        'group_photo_changed',
      ],
    },
    systemEventData: {
      type: {
        actorId: String,
        actorName: String,
        targetId: String,
        targetName: String,
        oldValue: String,
        newValue: String,
      },
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient pagination
messageSchema.index({ roomId: 1, timestamp: -1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);

export default Message;
