import React, { useState } from 'react';
import { ArrowLeft, Smartphone, MessageSquare, Copy, CheckCircle, QrCode } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../ui/input-otp';
import { Alert, AlertDescription } from '../ui/alert';
import type { AuthScreen } from './types';

interface MFAEnrollmentProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function MFAEnrollment({ onNavigate }: MFAEnrollmentProps) {
  const [step, setStep] = useState<'setup' | 'verify'>('setup');
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [code, setCode] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  
  // MFA secret must be fetched from the server during enrollment — never hardcoded.
  const secret: string | null = null;

  const copySecret = () => {
    if (!secret) return;
    navigator.clipboard.writeText(secret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length === 6) {
      onNavigate('profile-settings');
    }
  };

  if (step === 'verify') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="shadow-lg border-0">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <Smartphone className="h-6 w-6 text-success" />
              </div>
              <CardTitle>Verify your setup</CardTitle>
              <CardDescription>
                Enter a code from your authenticator app to complete setup
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVerify} className="space-y-6">
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

                <div className="space-y-3">
                  <PillButton 
                    type="submit" 
                    className="w-full h-12"
                    disabled={code.length !== 6}
                  >
                    Complete setup
                  </PillButton>
                  
                  <PillButton 
                    variant="outline" 
                    className="w-full h-12"
                    onClick={() => setStep('setup')}
                  >
                    Back to setup
                  </PillButton>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <button 
            onClick={() => onNavigate('login')}
            className="flex items-center text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Skip for now
          </button>
        </div>

        <Card className="shadow-lg border-0">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Smartphone className="h-5 w-5 mr-2" />
              Set up two-factor authentication
            </CardTitle>
            <CardDescription>
              Add an extra layer of security to protect your BailBonds Dashboard account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Authenticator App Section */}
            <div>
              <h3 className="text-lg mb-4">1. Set up authenticator app</h3>
              
              <div className="bg-muted/30 p-6 rounded-lg mb-4">
                <div className="flex items-center justify-center mb-4">
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <div className="w-32 h-32 bg-slate-100 rounded flex items-center justify-center">
                      <QrCode className="h-16 w-16 text-slate-400" />
                    </div>
                  </div>
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-4">
                    Scan this QR code with your authenticator app
                  </p>
                  
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Can't scan? Enter this code manually:
                    </p>
                    <div className="flex items-center justify-center space-x-2">
                      <code className="bg-muted px-2 py-1 rounded text-sm font-mono text-muted-foreground">
                        {secret ?? 'Not available — server setup required'}
                      </code>
                      <button
                        onClick={copySecret}
                        disabled={!secret}
                        className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {secretCopied ? (
                          <CheckCircle className="h-4 w-4 text-success" />
                        ) : (
                          <Copy className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <Alert className="border-blue-200 bg-blue-50">
                <Smartphone className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  <strong>Recommended apps:</strong> Google Authenticator, Authy, or 1Password
                </AlertDescription>
              </Alert>
            </div>

            {/* SMS Backup Section */}
            <div>
              <h3 className="text-lg mb-4">2. SMS backup (optional)</h3>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label htmlFor="sms-backup">Enable SMS backup</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive codes via text message as a fallback
                    </p>
                  </div>
                </div>
                <Switch 
                  id="sms-backup"
                  checked={smsEnabled}
                  onCheckedChange={setSmsEnabled}
                />
              </div>
            </div>

            {/* Security Notice */}
            <Alert>
              <AlertDescription>
                <strong>Security policy:</strong> Two-factor authentication is required for all agents handling sensitive case data across multiple counties.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <PillButton 
                className="w-full h-12"
                onClick={() => setStep('verify')}
                disabled={!secret}
              >
                Continue to verification
              </PillButton>
              
              <PillButton 
                variant="outline" 
                className="w-full h-12"
                onClick={() => onNavigate('profile-settings')}
              >
                Set up later
              </PillButton>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
