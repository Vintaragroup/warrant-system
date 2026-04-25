import React, { useEffect } from 'react';
import { Chrome, Apple, Loader2, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { AuthScreen } from './types';

interface SocialRedirectProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function SocialRedirect({ onNavigate }: SocialRedirectProps) {
  const [provider, setProvider] = React.useState<'google' | 'apple'>('google');

  useEffect(() => {
    // Simulate redirect completion after 3 seconds
    const timer = setTimeout(() => {
      onNavigate('auth-success');
    }, 3000);

    return () => clearTimeout(timer);
  }, [onNavigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg border-0">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              {provider === 'google' ? (
                <Chrome className="h-8 w-8 text-primary" />
              ) : (
                <Apple className="h-8 w-8 text-primary" />
              )}
            </div>
            <CardTitle>Signing you in securely</CardTitle>
            <CardDescription>
              Connecting with {provider === 'google' ? 'Google' : 'Apple'}...
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                Redirecting back from {provider === 'google' ? 'Google' : 'Apple'}
              </span>
            </div>

            <div className="bg-muted/30 rounded-lg p-4">
              <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>Secured by OAuth 2.0</span>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>• We never store your {provider === 'google' ? 'Google' : 'Apple'} password</p>
              <p>• Your credentials are encrypted end-to-end</p>
              <p>• This process typically takes 5-10 seconds</p>
            </div>

            <button 
              onClick={() => onNavigate('login')}
              className="text-sm text-primary hover:underline"
            >
              Having trouble? Return to sign in
            </button>
          </CardContent>
        </Card>

        {/* Provider selector for demo */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center space-x-2 bg-white rounded-full p-1 shadow-sm border">
            <button
              onClick={() => setProvider('google')}
              className={`px-3 py-1 rounded-full text-xs transition-colors ${
                provider === 'google' 
                  ? 'bg-primary text-white' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Google
            </button>
            <button
              onClick={() => setProvider('apple')}
              className={`px-3 py-1 rounded-full text-xs transition-colors ${
                provider === 'apple' 
                  ? 'bg-primary text-white' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Apple
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
