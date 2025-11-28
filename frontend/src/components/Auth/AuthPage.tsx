import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import { LockOutlined, Email, Pin, Person } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';

type AuthStep = 'email' | 'otp' | 'name';

const AuthPage: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
    setError('');

    if (otp.length !== 6) {
      setError('OTP must be 6 digits');
      return;
    }

    if (isNewUser) {
      setStep('name');
    } else {
      setIsLoading(true);
      try {
        await verifyOtp(email, otp);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid OTP');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsLoading(true);
    try {
      await verifyOtp(email, otp, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const getStepIndex = (): number => {
    switch (step) {
      case 'email': return 0;
      case 'otp': return 1;
      case 'name': return 2;
      default: return 0;
    }
  };

  const steps = isNewUser
    ? ['Enter Email', 'Verify OTP', 'Create Profile']
    : ['Enter Email', 'Verify OTP'];

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
      <Card sx={{ maxWidth: 450, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box
              sx={{
                width: 70,
                height: 70,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <LockOutlined sx={{ color: 'white', fontSize: 35 }} />
            </Box>
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              Secure Chat
            </Typography>
            <Typography color="text.secondary">
              End-to-end encrypted messaging
            </Typography>
          </Box>

          <Stepper activeStep={getStepIndex()} alternativeLabel sx={{ mb: 3 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {step === 'email' && (
            <form onSubmit={handleEmailSubmit}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Enter your email to sign in or create an account. We'll send you a one-time code.
              </Typography>
              <TextField
                fullWidth
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                autoFocus
                InputProps={{
                  startAdornment: <Email sx={{ color: 'action.active', mr: 1 }} />,
                }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading || !email}
                sx={{ mt: 3, mb: 2, py: 1.5 }}
              >
                {isLoading ? <CircularProgress size={24} /> : 'Continue'}
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                We sent a 6-digit code to <strong>{email}</strong>.
                {isNewUser && ' This is a new account.'}
                <br />
                <Typography component="span" variant="caption" color="text.secondary">
                  (Check server logs in development)
                </Typography>
              </Typography>
              <TextField
                fullWidth
                label="Verification Code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                margin="normal"
                required
                autoFocus
                inputProps={{ maxLength: 6, style: { letterSpacing: '0.5em', textAlign: 'center' } }}
                placeholder="000000"
                InputProps={{
                  startAdornment: <Pin sx={{ color: 'action.active', mr: 1 }} />,
                }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading || otp.length !== 6}
                sx={{ mt: 3, mb: 2, py: 1.5 }}
              >
                {isLoading ? <CircularProgress size={24} /> : 'Verify'}
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={() => { setStep('email'); setOtp(''); }}
                disabled={isLoading}
              >
                Back
              </Button>
            </form>
          )}

          {step === 'name' && (
            <form onSubmit={handleNameSubmit}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Welcome! Create your profile to get started.
              </Typography>
              <TextField
                fullWidth
                label="Your Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                margin="normal"
                required
                autoFocus
                InputProps={{
                  startAdornment: <Person sx={{ color: 'action.active', mr: 1 }} />,
                }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading || !name.trim()}
                sx={{ mt: 3, mb: 2, py: 1.5 }}
              >
                {isLoading ? <CircularProgress size={24} /> : 'Create Account'}
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={() => setStep('otp')}
                disabled={isLoading}
              >
                Back
              </Button>
            </form>
          )}

          <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 3 }}>
            🔒 Your messages are end-to-end encrypted.
            <br />
            Multi-device support enabled.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default AuthPage;
