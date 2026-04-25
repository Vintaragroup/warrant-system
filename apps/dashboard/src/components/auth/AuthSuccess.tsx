import React, { useState, useEffect } from 'react';
import { CheckCircle, BarChart3, Users, Calendar, ArrowRight } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import type { AuthScreen } from './types';

interface AuthSuccessProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AuthSuccess({ onNavigate }: AuthSuccessProps) {
  const [progress, setProgress] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  const steps = [
    { id: 1, label: 'Verifying credentials', duration: 800 },
    { id: 2, label: 'Loading your dashboard', duration: 1200 },
    { id: 3, label: 'Syncing case data', duration: 1000 },
    { id: 4, label: 'Checking county permissions', duration: 900 },
    { id: 5, label: 'Finalizing setup', duration: 600 },
  ];

  useEffect(() => {
    let currentStep = 0;
    let totalProgress = 0;

    const processStep = () => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        const stepProgress = 100 / steps.length;
        
        setTimeout(() => {
          setCompletedSteps(prev => [...prev, step.id]);
          totalProgress += stepProgress;
          setProgress(totalProgress);
          currentStep++;
          
          if (currentStep < steps.length) {
            processStep();
          } else {
            // Completed - show dashboard button after a brief delay
            setTimeout(() => {
              setProgress(100);
            }, 300);
          }
        }, step.duration);
      }
    };

    processStep();
  }, []);

  const isComplete = progress === 100;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Card className="shadow-lg border-0">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-6 h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <CardTitle className="text-2xl">Welcome back!</CardTitle>
            <p className="text-muted-foreground mt-2">
              You're successfully signed in to BailBonds Dashboard
            </p>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* Progress Bar */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Setting up your workspace</span>
                <span className="text-primary">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Loading Steps */}
            <div className="space-y-3">
              {steps.map((step) => {
                const isCompleted = completedSteps.includes(step.id);
                const isCurrent = !isCompleted && completedSteps.length + 1 === step.id;
                
                return (
                  <div 
                    key={step.id}
                    className={`flex items-center space-x-3 transition-opacity duration-300 ${
                      isCompleted ? 'opacity-100' : isCurrent ? 'opacity-70' : 'opacity-30'
                    }`}
                  >
                    <div className={`h-2 w-2 rounded-full ${
                      isCompleted ? 'bg-success' : isCurrent ? 'bg-primary animate-pulse' : 'bg-muted'
                    }`} />
                    <span className="text-sm">{step.label}</span>
                    {isCompleted && <CheckCircle className="h-4 w-4 text-success ml-auto" />}
                  </div>
                );
              })}
            </div>

            {/* Quick Stats Preview */}
            {isComplete && (
              <div className="space-y-4 animate-in fade-in duration-500">
                <h3 className="text-sm text-muted-foreground text-center">
                  Your dashboard is ready
                </h3>
                
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <Users className="h-5 w-5 text-primary mx-auto mb-1" />
                    <div className="text-lg">12</div>
                    <div className="text-xs text-muted-foreground">Active Cases</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <Calendar className="h-5 w-5 text-primary mx-auto mb-1" />
                    <div className="text-lg">3</div>
                    <div className="text-xs text-muted-foreground">This Week</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <BarChart3 className="h-5 w-5 text-primary mx-auto mb-1" />
                    <div className="text-lg">5</div>
                    <div className="text-xs text-muted-foreground">Counties</div>
                  </div>
                </div>

                <PillButton 
                  className="w-full h-12 mt-6"
                  onClick={() => onNavigate('profile-settings')}
                >
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </PillButton>
              </div>
            )}

            {/* Footer */}
            <div className="text-center pt-4 border-t border-muted">
              <p className="text-xs text-muted-foreground">
                Last updated: Today, {new Date().toLocaleTimeString()} • Secure connection
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
