'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { User, TokenPair, AuthState } from '@/types';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import { keyManager } from '@/lib/keyManager';
import { indexedDBService } from '@/lib/indexeddb';
import {
  getDeviceFingerprint,
  getDeviceName,
  getDeviceType,
} from '@/lib/crypto';

interface AuthContextType extends AuthState {
  requestOtp: (email: string) => Promise<{ isNewUser: boolean; derivationSalt: string }>;
  verifyOtp: (email: string, otp: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (data: { name?: string; photoUrl?: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<TokenPair | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Initialize auth state from IndexedDB
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Initialize IndexedDB first
        await indexedDBService.init();

        // Try to load tokens from IndexedDB
        const storedTokens = await api.loadTokens();
        if (!storedTokens) {
          setIsLoading(false);
          return;
        }

        // Validate tokens with server
        const response = await api.getCurrentUser();
        if (!response.success || !response.data) {
          console.log('Token validation failed during session restore');
          await api.setTokens(null);
          await keyManager.clear();
          setIsLoading(false);
          return;
        }

        // Try to restore private key from IndexedDB
        const userData = response.data;
        const keyRestored = await keyManager.tryRestoreFromIndexedDB(userData.id);

        if (!keyRestored) {
          // No private key in IndexedDB - user needs to re-login
          console.log('Session expired: encryption keys not found. Please log in again.');
          await api.setTokens(null);
          setIsLoading(false);
          return;
        }

        // Session restored successfully
        setUser(userData);
        setTokens(storedTokens);
        setIsAuthenticated(true);

        // Connect to socket with userId for room subscriptions
        await socketService.connect(storedTokens.accessToken, userData.id);
      } catch (error) {
        console.error('Auth initialization failed:', error);
        await api.setTokens(null);
        await keyManager.clear();
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const requestOtp = useCallback(
    async (email: string): Promise<{ isNewUser: boolean; derivationSalt: string }> => {
      const response = await api.requestOtp(email);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to request OTP');
      }
      return response.data;
    },
    []
  );

  const verifyOtp = useCallback(async (email: string, otp: string, name?: string) => {
    const deviceFingerprint = getDeviceFingerprint();
    const deviceName = getDeviceName();
    const deviceType = getDeviceType();

    const response = await api.verifyOtp(
      email,
      otp,
      name,
      deviceFingerprint,
      deviceName,
      deviceType
    );

    if (!response.success || !response.data) {
      throw new Error(response.error || 'OTP verification failed');
    }

    const {
      user: userData,
      tokens: userTokens,
      encryptedPrivateKey,
      keyEncryptionSalt,
    } = response.data;

    // Set tokens first
    await api.setTokens(userTokens);

    // Initialize key manager BEFORE connecting socket
    // This ensures keys are ready when socket messages arrive
    try {
      await keyManager.initialize(
        encryptedPrivateKey,
        otp,
        email,
        keyEncryptionSalt,
        userData.id
      );
    } catch (keyError) {
      // Key initialization failed - roll back the auth state
      console.error('Failed to initialize encryption keys:', keyError);
      await api.setTokens(null);
      throw new Error('Failed to decrypt encryption keys. Please try again.');
    }

    // Now set auth state and connect socket (after keys are ready)
    setUser(userData);
    setTokens(userTokens);
    setIsAuthenticated(true);

    // Connect to socket with userId for room subscriptions
    await socketService.connect(userTokens.accessToken, userData.id);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Always perform complete cleanup regardless of API call success
      socketService.disconnect();
      await keyManager.clear();
      await api.setTokens(null);
      setUser(null);
      setTokens(null);
      setIsAuthenticated(false);
    }
  }, []);

  const updateUser = useCallback(
    async (data: { name?: string; photoUrl?: string | null }) => {
      if (!user) return;

      const response = await api.updateUser(data);
      if (response.success && response.data) {
        setUser(response.data);
      }
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        isLoading,
        isAuthenticated,
        requestOtp,
        verifyOtp,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
