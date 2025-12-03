'use client';

import dynamic from 'next/dynamic';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ChatProvider } from '@/hooks/useChat';
import LoadingScreen from '@/components/LoadingScreen';

// Dynamic imports for code splitting - these are client-side heavy components
const AuthPage = dynamic(() => import('@/components/auth/AuthPage'), {
  loading: () => <LoadingScreen />,
  ssr: false, // Auth page uses browser APIs
});

const ChatPage = dynamic(() => import('@/components/chat/ChatPage'), {
  loading: () => <LoadingScreen />,
  ssr: false, // Chat page uses socket.io and browser APIs
});

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return (
    <ChatProvider>
      <ChatPage />
    </ChatProvider>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
