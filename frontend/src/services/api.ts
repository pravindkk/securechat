import { ApiResponse, User, TokenPair, Chat, Room, Message, PaginatedResponse, Device } from '../types';
import { socketService } from './socket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

class ApiService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing: boolean = false;
  private refreshQueue: Array<{ resolve: (success: boolean) => void }> = [];

  constructor() {
    this.loadTokens();
  }

  loadTokens(): TokenPair | null {
    const stored = localStorage.getItem('tokens');
    if (stored) {
      const tokens = JSON.parse(stored);
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      return tokens;
    }
    return null;
  }

  setTokens(tokens: TokenPair | null): void {
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      localStorage.setItem('tokens', JSON.stringify(tokens));
    } else {
      this.accessToken = null;
      this.refreshToken = null;
      localStorage.removeItem('tokens');
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
      if (response.status === 401 && data.error === 'Token expired' && this.refreshToken) {
        const refreshed = await this.refresh();
        if (refreshed) {
          // Retry the request with new token
          (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
          });
          return retryResponse.json();
        }
      }

      return data;
    } catch (error) {
      console.error('API request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Request failed',
      };
    }
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
    // Handle concurrent refresh requests - queue them
    if (this.isRefreshing) {
      return new Promise((resolve) => {
        this.refreshQueue.push({ resolve });
      });
    }

    if (!this.refreshToken) return false;

    this.isRefreshing = true;

    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        this.setTokens(data.data);
        
        // Reconnect socket with new token if it was connected
        if (socketService.isConnected()) {
          try {
            socketService.disconnect();
            await socketService.connect(data.data.accessToken);
          } catch (socketError) {
            console.error('Failed to reconnect socket after token refresh:', socketError);
          }
        }
        
        // Resolve all queued refresh requests with success
        this.refreshQueue.forEach(({ resolve }) => resolve(true));
        this.refreshQueue = [];
        
        return true;
      }
      
      // Refresh response was not successful
      this.setTokens(null);
      this.refreshQueue.forEach(({ resolve }) => resolve(false));
      this.refreshQueue = [];
      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
      // Refresh failed - clear tokens and reject queued requests
      this.setTokens(null);
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
    this.setTokens(null);
    return result;
  }

  async getCurrentUser(): Promise<ApiResponse<{ user: User }>> {
    return this.request('/api/auth/me');
  }

  async getEncryptedPrivateKey(): Promise<ApiResponse<{ encryptedPrivateKey: string; keyEncryptionSalt: string }>> {
    return this.request('/api/auth/keys');
  }

  // User endpoints
  async searchUsers(query: string): Promise<ApiResponse<{ users: User[] }>> {
    return this.request(`/api/users?q=${encodeURIComponent(query)}`);
  }

  async getUser(userId: string): Promise<ApiResponse<{ user: User }>> {
    return this.request(`/api/users/${userId}`);
  }

  async updateUser(userId: string, data: { name?: string; photoUrl?: string | null }): Promise<ApiResponse<{ user: User }>> {
    return this.request(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getUserPublicKey(userId: string): Promise<ApiResponse<{ publicKey: string }>> {
    return this.request(`/api/users/${userId}/public-key`);
  }

  async getDevices(): Promise<ApiResponse<{ devices: Device[] }>> {
    return this.request('/api/users/me/devices');
  }

  async removeDevice(deviceId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/users/me/devices/${deviceId}`, {
      method: 'DELETE',
    });
  }

  // Room endpoints
  async createRoom(
    memberIds: string[],
    name?: string,
    isPrivate: boolean = true
  ): Promise<ApiResponse<{ room: Room }>> {
    return this.request('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ memberIds, name, isPrivate }),
    });
  }

  async getChats(): Promise<ApiResponse<{ chats: Chat[] }>> {
    return this.request('/api/rooms/chats');
  }

  async getRoom(roomId: string): Promise<ApiResponse<{ room: Room }>> {
    return this.request(`/api/rooms/${roomId}`);
  }

  async getRoomKey(roomId: string): Promise<ApiResponse<{ encryptedRoomKey: string }>> {
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

  // Message endpoints
  async getMessages(
    roomId: string,
    limit?: number,
    before?: string
  ): Promise<ApiResponse<PaginatedResponse<Message>>> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit.toString());
    if (before) params.set('before', before);
    return this.request(`/api/messages/${roomId}?${params}`);
  }

  async sendMessage(
    roomId: string,
    encryptedContent: string,
    iv: string,
    authTag: string,
    type: string = 'text',
    mediaUrl?: string,
    mediaType?: string
  ): Promise<ApiResponse<{ message: Message }>> {
    return this.request(`/api/messages/${roomId}`, {
      method: 'POST',
      body: JSON.stringify({ encryptedContent, iv, authTag, type, mediaUrl, mediaType }),
    });
  }

  async deleteMessage(messageId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  // Upload endpoints
  async uploadFile(file: File, folder: string = 'messages'): Promise<ApiResponse<{
    url: string;
    key: string;
    size: number;
    mimeType: string;
    originalName: string;
  }>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);

    const headers: HeadersInit = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });
      return response.json();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  async uploadBase64(
    data: string,
    filename: string,
    mimeType: string,
    folder: string = 'messages'
  ): Promise<ApiResponse<{
    url: string;
    key: string;
    size: number;
    mimeType: string;
    originalName: string;
  }>> {
    return this.request('/api/upload/base64', {
      method: 'POST',
      body: JSON.stringify({ data, filename, mimeType, folder }),
    });
  }

  async deleteFile(key: string): Promise<ApiResponse<void>> {
    return this.request(`/api/upload/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiService();
export default api;
