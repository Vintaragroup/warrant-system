import React from 'react';
import { cn } from './utils';

interface StatusChipProps {
  status: 'active' | 'inactive' | 'pending' | 'error' | 'success';
  children: React.ReactNode;
  className?: string;
}

export function StatusChip({ status, children, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs',
        {
          'bg-success/10 text-success': status === 'success' || status === 'active',
          'bg-muted text-muted-foreground': status === 'inactive',
          'bg-yellow-100 text-yellow-800': status === 'pending',
          'bg-destructive/10 text-destructive': status === 'error',
        },
        className
      )}
    >
      {children}
    </span>
  );
}