import React, { useState, useEffect } from 'react';
import { ArrowLeft, Smartphone, MessageSquare, RefreshCw, AlertCircle } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../ui/input-otp';
import { Alert, AlertDescription } from '../ui/alert';
import type { AuthScreen } from './types';

interface MFAChallengeProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function MFAChallenge({ onNavigate }: MFAChallengeProps) {
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<'totp' | 'sms'>('totp');
  const [timeLeft, setTimeLeft] = useState(30);
  const [error, setError] = useState('');
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (method === 'totp' && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [timeLeft, method]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (code.length !== 6) {
      setError('Please enter a complete 6-digit code');
      return;
    }
    
    // Simulate wrong code
    if (code === '123456') {
      setError('Invalid code. Please try again.');
      setCode('');
      return;
    }
    
    onNavigate('auth-success');
  };

  const handleResendSMS = async () => {
    setIsResending(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsResending(false);
    setTimeLeft(30);
  };

  const switchToSMS = () => {
    setMethod('sms');
    setTimeLeft(30);
    setCode('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <button 
            onClick={() => onNavigate('login')}
            className="flex items-center text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to sign in
          </button>
        </div>

        <Card className="shadow-lg border-0">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              {method === 'totp' ? (
                <Smartphone className="h-6 w-6 text-primary" />
              ) : (
                <MessageSquare className="h-6 w-6 text-primary" />
              )}
            </div>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              {method === 'totp' 
                ? 'Enter the 6-digit code from your authenticator app'
                : 'Enter the 6-digit code sent to your phone'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert className="mb-6 border-destructive/50 bg-destructive/5">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <AlertDescription className="text-destructive">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(value) => setCode(value)}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {method === 'totp' && (
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-2">
                    Code expires in {timeLeft} seconds
                  </div>
                  <div className={`h-1 bg-muted rounded-full overflow-hidden`}>
                    <div 
                      className="h-full bg-primary transition-all duration-1000 ease-linear"
                      style={{ width: `${(timeLeft / 30) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <PillButton 
                type="submit" 
                className="w-full h-12"
                disabled={code.length !== 6}
              >
                Verify and continue
              </PillButton>
            </form>

            <div className="mt-6 space-y-4">
              {method === 'totp' ? (
                <div className="text-center">
                  <button 
                    onClick={switchToSMS}
                    className="text-sm text-primary hover:underline"
                  >
                    Use SMS instead
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-2">
                  <button 
                    onClick={handleResendSMS}
                    disabled={isResending || timeLeft > 0}
                    className="flex items-center justify-center text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline mx-auto"
                  >
                    {isResending ? (
                      <>
                        <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                        Sending...
                      </>
                    ) : timeLeft > 0 ? (
                      `Resend code in ${timeLeft}s`
                    ) : (
                      'Resend SMS code'
                    )}
                  </button>
                  <div>
                    <button 
                      onClick={() => setMethod('totp')}
                      className="text-sm text-primary hover:underline"
                    >
                      Use authenticator app instead
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 p-4 bg-muted/30 rounded-lg">
              <h4 className="text-sm mb-2">Security notice:</h4>
              <p className="text-xs text-muted-foreground">
                This extra security step helps protect your BailBonds Dashboard account and client data.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
