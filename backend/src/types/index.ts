import { Request } from 'express';

export interface UserPayload {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface EncryptedMessageData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}
