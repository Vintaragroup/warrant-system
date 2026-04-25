import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

export interface CheckInSummaryProps {
  isLoading?: boolean;
  stats: {
    upcoming: number;
    overdue: number;
    completed: number;
    gpsEnabled: number;
  };
}

const SUMMARY_ITEMS: Array<keyof CheckInSummaryProps['stats']> = ['upcoming', 'overdue', 'completed', 'gpsEnabled'];

const LABELS: Record<keyof CheckInSummaryProps['stats'], { title: string; description: string }> = {
  upcoming: { title: 'Upcoming', description: 'Scheduled in the next 24h' },
  overdue: { title: 'Overdue', description: 'Require immediate outreach' },
  completed: { title: 'Completed', description: 'Marked attended this week' },
  gpsEnabled: { title: 'GPS Enabled', description: 'Clients auto-pinging location' },
};

export function CheckInSummary({ isLoading = false, stats }: CheckInSummaryProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {SUMMARY_ITEMS.map((key) => {
        const value = stats?.[key] ?? 0;
        const { title, description } = LABELS[key];
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-3xl font-semibold text-slate-900">{value}</span>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default CheckInSummary;
