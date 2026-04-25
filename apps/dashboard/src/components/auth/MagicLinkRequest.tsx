import React, { useState } from 'react';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type { AuthScreen } from './types';
import { useUser } from '../UserContext';

interface MagicLinkRequestProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function MagicLinkRequest({ onNavigate }: MagicLinkRequestProps) {
  const { sendMagicLink, loading, error: authError } = useUser();
  const [email, setEmail] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email) {
      setError('Email is required');
      return;
    }
    
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }
    
    try {
      await sendMagicLink(email);
      setIsSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send magic link';
      setError(message);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="shadow-lg border-0">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                We've sent a secure sign-in link to<br />
                <span className="text-foreground">{email}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center space-y-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Click the link in your email to securely sign in to your BailBonds Dashboard
                  </p>
                </div>
                
                <div className="text-sm text-muted-foreground">
                  <p>Link expires in 15 minutes</p>
                  <p className="mt-2">
                    Didn't receive it?{' '}
                    <button 
                      onClick={() => setIsSuccess(false)}
                      className="text-primary hover:underline"
                    >
                      Send again
                    </button>
                  </p>
                </div>
              </div>

              <PillButton 
                variant="outline" 
                className="w-full h-12"
                onClick={() => onNavigate('login')}
              >
                Back to sign in
              </PillButton>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
            <CardTitle>Sign in with magic link</CardTitle>
            <CardDescription>
              Enter your email and we'll send you a secure link to sign in instantly
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(error || authError) && (
              <div className="bg-destructive/5 border border-destructive/40 rounded-lg p-3 text-sm text-destructive mb-4">
                {error || authError}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="agent@bailbonds.com"
                  className={error ? 'border-destructive' : ''}
                />
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </div>

              <PillButton type="submit" className="w-full h-12" disabled={loading}>
                {loading ? 'Sending...' : 'Send magic link'}
              </PillButton>
            </form>

            <div className="mt-8 p-4 bg-muted/30 rounded-lg">
              <h4 className="text-sm mb-2">How it works:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• We'll email you a secure, one-time link</li>
                <li>• Click the link to instantly sign in</li>
                <li>• No password required - completely secure</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
