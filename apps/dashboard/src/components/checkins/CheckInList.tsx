import React from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

export interface CheckInListItem {
  id: string;
  clientName: string;
  caseNumber?: string | null;
  county?: string | null;
  dueAt?: string | null;
  status: 'pending' | 'upcoming' | 'overdue' | 'done';
  contactCount?: number;
  lastContactAt?: string | null;
  method?: string | null;
  note?: string | null;
  location?: { lat?: number | null; lng?: number | null } | null;
  gpsEnabled?: boolean;
  attendance?: { status: string; recordedAt?: string | null } | null;
}

export interface CheckInListProps {
  isLoading?: boolean;
  items: CheckInListItem[];
  onMarkDone?: (id: string) => void;
  onLogContact?: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  isMarking?: boolean;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusBadge(status: CheckInListItem['status']) {
  switch (status) {
    case 'done':
      return <Badge className="bg-emerald-100 text-emerald-700">Completed</Badge>;
    case 'overdue':
      return <Badge className="bg-amber-100 text-amber-700">Overdue</Badge>;
    case 'upcoming':
      return <Badge className="bg-blue-100 text-blue-700">Upcoming</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-700">Pending</Badge>;
  }
}

export function CheckInList({
  isLoading = false,
  items,
  onMarkDone,
  onLogContact,
  onOpenDetail,
  isMarking = false,
}: CheckInListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-60" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-slate-500">No check-ins match the current filters.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card key={item.id} className="hover:border-blue-200">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-slate-900">{item.clientName}</p>
                {statusBadge(item.status)}
                {item.gpsEnabled ? <Badge variant="outline">GPS</Badge> : null}
              </div>
              <p className="text-xs text-slate-500">
                {item.caseNumber ? `Case ${item.caseNumber}` : 'No case #'} • {item.county || 'Unknown county'}
              </p>
              <p className="text-xs text-slate-500">Due {formatDate(item.dueAt)} • via {item.method?.toUpperCase?.() || 'N/A'}</p>
              <p className="text-xs text-slate-500">
                Contact attempts: {item.contactCount ?? 0} • Last contact: {formatDate(item.lastContactAt)}
              </p>
              {item.attendance ? (
                <p className="text-xs text-slate-500">
                  Attendance: {item.attendance.status}
                  {item.attendance.recordedAt ? ` • ${formatDate(item.attendance.recordedAt)}` : ''}
                </p>
              ) : null}
              {item.location?.lat && item.location?.lng ? (
                <p className="text-xs text-slate-500">
                  Last known location: {item.location.lat.toFixed(3)}, {item.location.lng.toFixed(3)}
                </p>
              ) : null}
              {item.note ? <p className="mt-2 text-xs text-slate-600">{item.note}</p> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onOpenDetail ? (
                <Button variant="outline" size="sm" onClick={() => onOpenDetail(item.id)}>
                  View details
                </Button>
              ) : null}
              {onLogContact ? (
                <Button variant="outline" size="sm" onClick={() => onLogContact(item.id)}>
                  Log contact
                </Button>
              ) : null}
              {onMarkDone ? (
                <Button
                  size="sm"
                  onClick={() => onMarkDone(item.id)}
                  disabled={item.status === 'done' || isMarking}
                >
                  Mark completed
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default CheckInList;
