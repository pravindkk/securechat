import {
  ApiResponse,
  User,
  TokenPair,
  Chat,
  Room,
  RoomMember,
  Message,
  PaginatedResponse,
} from '@/types';
import { indexedDBService } from '@/lib/indexeddb';

// Use relative paths for internal API routes
const API_URL = '';

class ApiService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing: boolean = false;
  private refreshQueue: Array<{ resolve: (success: boolean) => void }> = [];
  private refreshRetryCount: number = 0;
  private static readonly MAX_REFRESH_RETRIES = 3;
  private initialized: boolean = false;

  /**
   * Initialize API service with tokens from IndexedDB
   */
  async init(): Promise<TokenPair | null> {
    if (this.initialized) {
      return this.accessToken && this.refreshToken
        ? { accessToken: this.accessToken, refreshToken: this.refreshToken }
        : null;
    }

    try {
      await indexedDBService.init();
      const tokens = await indexedDBService.getTokens();
      if (tokens) {
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
      }
      this.initialized = true;
      return tokens;
    } catch {
      this.initialized = true;
      return null;
    }
  }

  /**
   * Load tokens from IndexedDB (for backward compatibility)
   */
  async loadTokens(): Promise<TokenPair | null> {
    return this.init();
  }

  /**
   * Set tokens and persist to IndexedDB
   */
  async setTokens(tokens: TokenPair | null): Promise<void> {
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      await indexedDBService.storeTokens(tokens.accessToken, tokens.refreshToken);
    } else {
      this.accessToken = null;
      this.refreshToken = null;
      await indexedDBService.clearTokens();
    }
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      // Handle token expiration
      if (response.status === 401 && this.refreshToken) {
        const refreshed = await this.refresh();
        if (refreshed) {
          // Retry the request with new token
          (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
          });
          return this.transformResponse(await retryResponse.json());
        }
      }

      return this.transformResponse(data);
    } catch (error) {
      console.error('API request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Request failed',
      };
    }
  }

  // Transform API response to match expected format
  private transformResponse<T>(data: any): ApiResponse<T> {
    // If response already has success field, return as-is
    if ('success' in data) {
      return data;
    }

    // If response has error field, it's an error
    if ('error' in data) {
      return { success: false, error: data.error };
    }

    // Otherwise, wrap data in success response
    return { success: true, data };
  }

  // Auth endpoints
  async requestOtp(email: string): Promise<ApiResponse<{ isNewUser: boolean; derivationSalt: string }>> {
    return this.request('/api/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyOtp(
    email: string,
    otp: string,
    name: string | undefined,
    deviceFingerprint: string,
    deviceName: string,
    deviceType: string
  ): Promise<ApiResponse<{
    user: User;
    tokens: TokenPair;
    isNewUser: boolean;
    encryptedPrivateKey: string;
    keyEncryptionSalt: string;
  }>> {
    return this.request('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp, name, deviceFingerprint, deviceName, deviceType }),
    });
  }

  async refresh(): Promise<boolean> {
    if (this.isRefreshing) {
      return new Promise((resolve) => {
        this.refreshQueue.push({ resolve });
      });
    }

    if (!this.refreshToken) return false;

    if (this.refreshRetryCount >= ApiService.MAX_REFRESH_RETRIES) {
      console.error('Max token refresh retries exceeded, forcing logout');
      await this.setTokens(null);
      this.refreshRetryCount = 0;
      return false;
    }

    this.isRefreshing = true;
    this.refreshRetryCount++;

    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      const data = await response.json();

      if (data.accessToken && data.refreshToken) {
        await this.setTokens(data);
        this.refreshRetryCount = 0;
        this.refreshQueue.forEach(({ resolve }) => resolve(true));
        this.refreshQueue = [];
        return true;
      }

      await this.setTokens(null);
      this.refreshQueue.forEach(({ resolve }) => resolve(false));
      this.refreshQueue = [];
      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
      await this.setTokens(null);
      this.refreshQueue.forEach(({ resolve }) => resolve(false));
      this.refreshQueue = [];
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  async logout(): Promise<ApiResponse<void>> {
    const result = await this.request<void>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    await this.setTokens(null);
    return result;
  }

  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.request('/api/auth/me');
  }

  // User endpoints
  async searchUsers(query: string): Promise<ApiResponse<User[]>> {
    return this.request(`/api/users?q=${encodeURIComponent(query)}`);
  }

  async getUser(userId: string): Promise<ApiResponse<User>> {
    return this.request(`/api/users/${userId}`);
  }

  async updateUser(
    data: { name?: string; photoUrl?: string | null }
  ): Promise<ApiResponse<User>> {
    return this.request('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // Room endpoints
  async createRoom(
    memberIds: string[],
    name?: string,
    isPrivate: boolean = true
  ): Promise<ApiResponse<Room>> {
    return this.request('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ memberIds, name, isPrivate }),
    });
  }

  async getChats(): Promise<ApiResponse<Chat[]>> {
    return this.request('/api/rooms');
  }

  async getRoom(roomId: string): Promise<ApiResponse<Room>> {
    return this.request(`/api/rooms/${roomId}`);
  }

  async getRoomKey(roomId: string): Promise<ApiResponse<{ encryptedRoomKey: string; keyVersion: number }>> {
    return this.request(`/api/rooms/${roomId}/key`);
  }

  async markAsRead(roomId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/rooms/${roomId}/read`, {
      method: 'POST',
    });
  }

  async deleteRoom(roomId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
  }

  // Group endpoints
  async createGroupRoom(memberIds: string[], name: string): Promise<ApiResponse<Room>> {
    return this.request('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ memberIds, name, isPrivate: false }),
    });
  }

  async addMember(
    roomId: string,
    userId: string,
    encryptedRoomKey: string,
    historicalKeys?: Array<{ version: number; encryptedKey: string }>
  ): Promise<ApiResponse<{ member: RoomMember }>> {
    return this.request(`/api/rooms/${roomId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, encryptedRoomKey, historicalKeys }),
    });
  }

  async removeMember(roomId: string, userId: string): Promise<ApiResponse<{ newKeyVersion: number }>> {
    return this.request(`/api/rooms/${roomId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  async leaveRoom(roomId: string): Promise<ApiResponse<{ roomDeleted: boolean; newKeyVersion: number | null }>> {
    return this.request(`/api/rooms/${roomId}/leave`, {
      method: 'POST',
    });
  }

  async promoteMember(roomId: string, userId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/rooms/${roomId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin' }),
    });
  }

  async demoteMember(roomId: string, userId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/rooms/${roomId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'member' }),
    });
  }

  async getRoomMembers(roomId: string): Promise<ApiResponse<RoomMember[]>> {
    return this.request(`/api/rooms/${roomId}/members`);
  }

  async rotateRoomKey(
    roomId: string,
    encryptedKeys: Record<string, string>
  ): Promise<ApiResponse<{ keyVersion: number }>> {
    return this.request(`/api/rooms/${roomId}/key`, {
      method: 'POST',
      body: JSON.stringify({ encryptedKeys }),
    });
  }

  // Message endpoints
  async getMessages(
    roomId: string,
    limit?: number,
    before?: string
  ): Promise<ApiResponse<PaginatedResponse<Message>>> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit.toString());
    if (before) params.set('before', before);
    return this.request(`/api/rooms/${roomId}/messages?${params}`);
  }

  async sendMessage(
    roomId: string,
    encryptedContent: string,
    iv: string,
    authTag: string,
    type: string = 'text',
    mediaUrl?: string,
    mediaType?: string
  ): Promise<ApiResponse<Message>> {
    return this.request(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        encryptedContent,
        iv,
        authTag,
        type,
        mediaUrl,
        mediaType,
      }),
    });
  }

  async deleteMessage(roomId: string, messageId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/rooms/${roomId}/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  // Additional methods needed by hooks
  async getRoomKeyVersion(
    roomId: string,
    version: number
  ): Promise<ApiResponse<{ encryptedRoomKey: string; version: number }>> {
    return this.request(`/api/rooms/${roomId}/key?version=${version}`);
  }

  async getUserPublicKey(userId: string): Promise<ApiResponse<{ publicKey: string }>> {
    const response = await this.request<{ publicKey: string }>(`/api/users/${userId}`);
    if (response.success && response.data) {
      return { success: true, data: { publicKey: (response.data as any).publicKey } };
    }
    return response;
  }

  async getRoomKeyHistory(roomId: string): Promise<ApiResponse<{
    keyHistory: Array<{ version: number; encryptedRoomKey: string }>;
    currentVersion: number;
  }>> {
    return this.request(`/api/rooms/${roomId}/key-history`);
  }

  async updateGroup(
    roomId: string,
    data: { name?: string; photoUrl?: string | null }
  ): Promise<ApiResponse<Room>> {
    return this.request(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteGroup(roomId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiService();
export default api;
