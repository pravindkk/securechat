'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  TextField,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Fade,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '@/hooks/useAuth';

type AuthStep = 'email' | 'otp' | 'name';

export default function AuthPage() {
  const { requestOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await requestOtp(email);
      setIsNewUser(result.isNewUser);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNewUser && !name.trim()) {
      setStep('name');
      return;
    }

    setIsLoading(true);

    try {
      await verifyOtp(email, otp, isNewUser ? name : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setIsLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsLoading(true);

    try {
      await verifyOtp(email, otp, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'email':
        return (
          <Fade in={true}>
            <form onSubmit={handleEmailSubmit}>
              <Typography variant="h5" gutterBottom fontWeight={600}>
                Welcome to SecureChat
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Enter your email to continue
              </Typography>

              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
                autoFocus
                sx={{ mb: 2 }}
              />

              <Button
                fullWidth
                variant="contained"
                type="submit"
                disabled={isLoading || !email}
                size="large"
              >
                {isLoading ? <CircularProgress size={24} /> : 'Continue'}
              </Button>
            </form>
          </Fade>
        );

      case 'otp':
        return (
          <Fade in={true}>
            <form onSubmit={handleOtpSubmit}>
              <Typography variant="h5" gutterBottom fontWeight={600}>
                Enter verification code
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                We sent a code to {email}
              </Typography>

              <TextField
                fullWidth
                label="Verification Code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isLoading}
                required
                autoFocus
                inputProps={{ maxLength: 6, inputMode: 'numeric' }}
                sx={{ mb: 2 }}
              />

              <Button
                fullWidth
                variant="contained"
                type="submit"
                disabled={isLoading || otp.length !== 6}
                size="large"
              >
                {isLoading ? <CircularProgress size={24} /> : 'Verify'}
              </Button>

              <Button
                fullWidth
                variant="text"
                onClick={() => setStep('email')}
                sx={{ mt: 1 }}
                disabled={isLoading}
              >
                Change email
              </Button>
            </form>
          </Fade>
        );

      case 'name':
        return (
          <Fade in={true}>
            <form onSubmit={handleNameSubmit}>
              <Typography variant="h5" gutterBottom fontWeight={600}>
                Create your profile
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                What should we call you?
              </Typography>

              <TextField
                fullWidth
                label="Display Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                required
                autoFocus
                sx={{ mb: 2 }}
              />

              <Button
                fullWidth
                variant="contained"
                type="submit"
                disabled={isLoading || !name.trim()}
                size="large"
              >
                {isLoading ? <CircularProgress size={24} /> : 'Get Started'}
              </Button>
            </form>
          </Fade>
        );
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        p: 2,
      }}
    >
      <Card
        sx={{
          p: 4,
          maxWidth: 400,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 3,
          }}
        >
          <LockOutlinedIcon sx={{ color: 'white', fontSize: 28 }} />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {renderStep()}

        <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
          End-to-end encrypted messaging
        </Typography>
      </Card>
    </Box>
  );
}
