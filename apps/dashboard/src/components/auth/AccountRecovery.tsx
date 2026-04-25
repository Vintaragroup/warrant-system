import React, { useState } from 'react';
import { ArrowLeft, HelpCircle, MessageCircle, Shield, AlertTriangle, Phone, Mail } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import type { AuthScreen } from './types';

interface AccountRecoveryProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AccountRecovery({ onNavigate }: AccountRecoveryProps) {
  const [selectedIssue, setSelectedIssue] = useState<string>('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const issues = [
    { id: 'locked', label: 'Account is locked', icon: AlertTriangle },
    { id: 'compromised', label: 'Account may be compromised', icon: Shield },
    { id: 'access', label: 'Lost access to email/phone', icon: Phone },
    { id: 'other', label: 'Other issue', icon: HelpCircle },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="shadow-lg border-0">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <MessageCircle className="h-6 w-6 text-success" />
              </div>
              <CardTitle>Support request submitted</CardTitle>
              <CardDescription>
                We'll help you regain access to your account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Support ticket #BB-{Math.random().toString(36).substr(2, 6).toUpperCase()}
                </p>
                <p className="text-sm">
                  Our security team will contact you within 24 hours to verify your identity and restore access.
                </p>
              </div>

              <Alert className="border-blue-200 bg-blue-50">
                <Shield className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  For security, we may ask you to provide additional verification documents before restoring access.
                </AlertDescription>
              </Alert>

              <PillButton 
                className="w-full h-12"
                onClick={() => onNavigate('landing')}
              >
                Return to landing
              </PillButton>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-8">
          <button 
            onClick={() => onNavigate('landing')}
            className="flex items-center text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to landing
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Main Recovery Form */}
          <Card className="shadow-lg border-0">
            <CardHeader>
              <CardTitle className="flex items-center">
                <HelpCircle className="h-5 w-5 mr-2" />
                Account Recovery Help
              </CardTitle>
              <CardDescription>
                Can't access your BailBonds Dashboard account? We'll help you get back in.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-4">
                  <Label>What type of issue are you experiencing?</Label>
                  <div className="grid grid-cols-1 gap-3">
                    {issues.map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        onClick={() => setSelectedIssue(issue.id)}
                        className={`flex items-center p-4 border rounded-lg text-left transition-colors ${
                          selectedIssue === issue.id 
                            ? 'border-primary bg-primary/5' 
                            : 'border-input hover:bg-muted/50'
                        }`}
                      >
                        <issue.icon className="h-5 w-5 mr-3 text-muted-foreground" />
                        <span>{issue.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email address associated with account</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="agent@bailbonds.com"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">
                    Describe the issue and provide any relevant details
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Please describe what happened when you tried to access your account..."
                    rows={4}
                    required
                  />
                </div>

                <PillButton 
                  type="submit" 
                  className="w-full h-12"
                  disabled={!selectedIssue || !email || !description}
                >
                  Submit recovery request
                </PillButton>
              </form>
            </CardContent>
          </Card>

          {/* Support Information */}
          <div className="space-y-6">
            {/* Contact Support */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <MessageCircle className="h-5 w-5 mr-2" />
                  Contact Support
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Mail className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm">Email</p>
                    <p className="text-sm text-muted-foreground">support@bailbonds.com</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Phone className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm">Phone</p>
                    <p className="text-sm text-muted-foreground">(555) 123-BAIL</p>
                    <p className="text-xs text-muted-foreground">Mon-Fri 8AM-6PM PT</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Security Best Practices */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Shield className="h-5 w-5 mr-2" />
                  Security Best Practices
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 bg-primary rounded-full mt-2 flex-shrink-0" />
                    <span>Use a unique, strong password for your account</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 bg-primary rounded-full mt-2 flex-shrink-0" />
                    <span>Enable two-factor authentication for extra security</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 bg-primary rounded-full mt-2 flex-shrink-0" />
                    <span>Never share your login credentials with others</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 bg-primary rounded-full mt-2 flex-shrink-0" />
                    <span>Log out completely when using shared computers</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 bg-primary rounded-full mt-2 flex-shrink-0" />
                    <span>Report suspicious activity immediately</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Common Issues */}
            <Card>
              <CardHeader>
                <CardTitle>Common Issues & Solutions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm mb-1">Password not working?</h4>
                  <p className="text-sm text-muted-foreground">
                    Try the{' '}
                    <button 
                      onClick={() => onNavigate('forgot-password')}
                      className="text-primary hover:underline"
                    >
                      password reset
                    </button>{' '}
                    option first.
                  </p>
                </div>
                <div>
                  <h4 className="text-sm mb-1">Can't receive SMS codes?</h4>
                  <p className="text-sm text-muted-foreground">
                    Check if your phone number is up to date in your profile settings.
                  </p>
                </div>
                <div>
                  <h4 className="text-sm mb-1">Account locked?</h4>
                  <p className="text-sm text-muted-foreground">
                    Accounts are temporarily locked after 5 failed login attempts for security.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
