import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User, TokenPair, AuthState } from '../types';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { keyManager } from '../crypto/keyManager';
import { getDeviceFingerprint, getDeviceName, getDeviceType } from '../crypto/encryption';

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

  // Initialize auth state from stored tokens
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedTokens = api.loadTokens();
        if (storedTokens) {
          const response = await api.getCurrentUser();
          if (response.success && response.data) {
            // Try to restore key manager from stored private key
            const storedPrivateKey = sessionStorage.getItem('privateKeyPem');
            if (storedPrivateKey) {
              await keyManager.reinitialize(storedPrivateKey);
              
              setUser(response.data.user);
              setTokens(storedTokens);
              setIsAuthenticated(true);

              // Connect to socket
              await socketService.connect(storedTokens.accessToken);
            } else {
              // No private key in session storage - user needs to re-login
              // This happens when the browser tab was closed
              console.log('No encryption keys found in session. Logging out...');
              api.setTokens(null);
            }
          }
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
        api.setTokens(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const requestOtp = useCallback(async (email: string): Promise<{ isNewUser: boolean; derivationSalt: string }> => {
    const response = await api.requestOtp(email);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to request OTP');
    }
    return response.data;
  }, []);

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

    const { user: userData, tokens: userTokens, encryptedPrivateKey, keyEncryptionSalt } = response.data;

    // Set tokens first
    api.setTokens(userTokens);
    setUser(userData);
    setTokens(userTokens);
    setIsAuthenticated(true);

    // Connect to socket
    await socketService.connect(userTokens.accessToken);

    // Initialize key manager with the OTP
    // The OTP is used to decrypt the private key
    await keyManager.initialize(encryptedPrivateKey, otp, email, keyEncryptionSalt);

    // Store the decrypted private key PEM in session storage
    // (This allows key recovery without re-entering OTP during the session)
    const privateKeyPem = keyManager.getPrivateKeyPem();
    if (privateKeyPem) {
      sessionStorage.setItem('privateKeyPem', privateKeyPem);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Always perform complete cleanup regardless of API call success
      socketService.disconnect();
      keyManager.clear();
      sessionStorage.removeItem('privateKeyPem');
      api.setTokens(null);  // Clear localStorage tokens
      setUser(null);
      setTokens(null);
      setIsAuthenticated(false);
    }
  }, []);

  const updateUser = useCallback(async (data: { name?: string; photoUrl?: string | null }) => {
    if (!user) return;

    const response = await api.updateUser(user.id, data);
    if (response.success && response.data) {
      setUser(response.data.user);
    }
  }, [user]);

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
