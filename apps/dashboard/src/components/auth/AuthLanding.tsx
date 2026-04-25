import React from 'react';
import { Shield, Users, Clock, BarChart3, Chrome, Apple } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { AuthScreen } from './types';

interface AuthLandingProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AuthLanding({ onNavigate }: AuthLandingProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="flex items-center justify-center mb-6">
              <Shield className="h-12 w-12 text-primary mr-3" />
              <h1 className="text-3xl text-slate-900">BailBonds Dashboard</h1>
            </div>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Secure case management and bond tracking for agents across all counties
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-16 items-start">
            {/* Benefits Section */}
            <div>
              <h2 className="text-2xl text-slate-900 mb-8">Why agents choose our platform</h2>
              <div className="space-y-6">
                <div className="flex items-start space-x-4">
                  <Users className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="text-slate-900 mb-2">Multi-County Access</h3>
                    <p className="text-muted-foreground">
                      Manage cases across counties with unified reporting and compliance tracking
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <Clock className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="text-slate-900 mb-2">Real-Time Updates</h3>
                    <p className="text-muted-foreground">
                      Get instant notifications on court dates, payment status, and case changes
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <BarChart3 className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="text-slate-900 mb-2">Advanced Analytics</h3>
                    <p className="text-muted-foreground">
                      Track performance metrics, risk assessments, and revenue analytics
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Auth Card */}
            <Card className="shadow-lg border-0">
              <CardHeader className="text-center pb-6">
                <CardTitle>Access Your Dashboard</CardTitle>
                <CardDescription>
                  Sign in to manage your bail bond cases and client relationships
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <PillButton 
                  className="w-full h-12" 
                  onClick={() => onNavigate('login')}
                >
                  Sign In
                </PillButton>
                
                <PillButton 
                  variant="outline" 
                  className="w-full h-12"
                  onClick={() => onNavigate('login')}
                >
                  Create Account
                </PillButton>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-muted" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <PillButton 
                    variant="outline" 
                    className="h-12"
                    onClick={() => onNavigate('social-redirect')}
                  >
                    <Chrome className="h-4 w-4 mr-2" />
                    Google
                  </PillButton>
                  <PillButton 
                    variant="outline" 
                    className="h-12"
                    onClick={() => onNavigate('social-redirect')}
                  >
                    <Apple className="h-4 w-4 mr-2" />
                    Apple
                  </PillButton>
                </div>

                <div className="text-center pt-4">
                  <button 
                    onClick={() => onNavigate('account-recovery')}
                    className="text-sm text-primary hover:underline"
                  >
                    Need help accessing your account?
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <div className="text-center mt-16 pt-8 border-t border-muted">
            <p className="text-sm text-muted-foreground">
              Protected by enterprise-grade security • SOC 2 Type II Certified
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
