import React from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '../ui/drawer';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';

export interface CheckInDetailDrawerProps {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  checkIn?: {
    id: string;
    clientName: string;
    caseNumber?: string | null;
    county?: string | null;
    dueAt?: string | null;
    status: string;
    note?: string | null;
    gpsEnabled?: boolean;
    lastPingAt?: string | null;
    pingStatus?: string | null;
    timeline: Array<{ label: string; timestamp: string; meta?: string }>;
    attendance?: { status: string; recordedAt?: string; note?: string | null } | null;
  } | null;
  onTriggerPing?: (id: string) => void;
}

export function CheckInDetailDrawer({ open, onOpenChange, checkIn, onTriggerPing }: CheckInDetailDrawerProps) {
  const data = checkIn || null;
  const formatDateTime = (value?: string | null) => {
    if (!value) return null;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="space-y-1">
          <DrawerTitle>{data ? data.clientName : 'Check-in details'}</DrawerTitle>
          <DrawerDescription>
            {data
              ? `Case ${data.caseNumber || '—'} • ${data.county || 'Unknown county'} • Due ${data.dueAt || '—'}`
              : 'Select a check-in to view activity and GPS pings.'}
          </DrawerDescription>
          {data?.gpsEnabled ? <Badge variant="outline">GPS Enabled</Badge> : null}
        </DrawerHeader>

        <div className="space-y-6 px-6 pb-8">
          {data ? (
            <>
              <section className="space-y-2">
                <div className="text-sm text-slate-600">
                  Status: <strong className="text-slate-900 capitalize">{data.status}</strong>
                </div>
                <div className="text-sm text-slate-600">
                  Last ping: <strong className="text-slate-900">{data.lastPingAt || 'No pings yet'}</strong>
                </div>
                {data.pingStatus ? (
                  <div className="text-sm text-slate-600">
                    Ping status: <strong className="text-slate-900">{data.pingStatus}</strong>
                  </div>
                ) : null}
                {data.attendance ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    <div>
                      Attendance:{' '}
                      <strong className="text-slate-900 capitalize">{data.attendance.status}</strong>
                    </div>
                    {formatDateTime(data.attendance.recordedAt) ? (
                      <div>Recorded: {formatDateTime(data.attendance.recordedAt)}</div>
                    ) : null}
                    {data.attendance.note ? <div>Notes: {data.attendance.note}</div> : null}
                  </div>
                ) : null}
                {data.note ? <p className="text-sm text-slate-600">Notes: {data.note}</p> : null}
                {onTriggerPing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onTriggerPing(data.id)}
                    className="mt-2"
                  >
                    Trigger manual ping
                  </Button>
                ) : null}
              </section>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Activity timeline</h3>
                <ul className="space-y-1 text-sm text-slate-600">
                  {data.timeline.length ? (
                    data.timeline.map((entry, index) => (
                      <li key={`${entry.timestamp}-${index}`} className="flex items-start gap-2">
                        <span className="mt-0.5 size-2 rounded-full bg-blue-500" />
                        <div>
                          <div className="font-medium text-slate-900">{entry.label}</div>
                          <div className="text-xs text-slate-500">{entry.timestamp}</div>
                          {entry.meta ? <div className="text-xs text-slate-500">{entry.meta}</div> : null}
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-slate-500">No timeline entries yet.</li>
                  )}
                </ul>
              </section>
            </>
          ) : (
            <p className="text-sm text-slate-600">Choose a check-in to view detailed information.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export default CheckInDetailDrawer;
