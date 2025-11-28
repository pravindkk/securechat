import mongoose, { Document, Schema } from 'mongoose';

export interface IMessage extends Document {
  roomId: string;
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'system';
  encryptedContent: string;
  iv: string;
  authTag: string;
  mediaUrl?: string;
  mediaType?: string;
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
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
    mediaUrl: {
      type: String,
    },
    mediaType: {
      type: String,
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
