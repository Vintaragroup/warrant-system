import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';

export interface CheckInFormValues {
  clientId: string;
  scheduleAt: string;
  timezone: string;
  officerId: string;
  method: 'sms' | 'call' | 'in-person';
  location?: string;
  notes?: string;
  remindersEnabled: boolean;
  gpsEnabled: boolean;
  pingsPerDay: number;
}

export interface CheckInFormModalProps {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSubmit: (values: CheckInFormValues) => Promise<void> | void;
  initialValues?: Partial<CheckInFormValues> | null;
  clients: Array<{ id: string; name: string }>;
  officers: Array<{ id: string; name: string }>;
  isSubmitting?: boolean;
}

const DEFAULT_VALUES: CheckInFormValues = {
  clientId: '',
  scheduleAt: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  officerId: '',
  method: 'sms',
  location: '',
  notes: '',
  remindersEnabled: true,
  gpsEnabled: false,
  pingsPerDay: 3,
};

export function CheckInFormModal({
  open,
  onOpenChange,
  onSubmit,
  initialValues,
  clients,
  officers,
  isSubmitting,
}: CheckInFormModalProps) {
  const [form, setForm] = useState<CheckInFormValues>(DEFAULT_VALUES);

  useEffect(() => {
    setForm({ ...DEFAULT_VALUES, ...initialValues });
  }, [initialValues, open]);

  const handleChange = (field: keyof CheckInFormValues, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialValues?.clientId ? 'Edit check-in' : 'Schedule check-in'}</DialogTitle>
          <DialogDescription>Configure reminders, GPS tracking, and responsible officer.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client">Client</Label>
              <Select value={form.clientId} onValueChange={(value) => handleChange('clientId', value)}>
                <SelectTrigger id="client">
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="officer">Assigned officer</Label>
              <Select value={form.officerId} onValueChange={(value) => handleChange('officerId', value)}>
                <SelectTrigger id="officer">
                  <SelectValue placeholder="Select officer" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {officers.map((officer) => (
                    <SelectItem key={officer.id} value={officer.id}>
                      {officer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheduleAt">Date & time</Label>
              <Input
                id="scheduleAt"
                type="datetime-local"
                value={form.scheduleAt}
                onChange={(event) => handleChange('scheduleAt', event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                value={form.timezone}
                onChange={(event) => handleChange('timezone', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="method">Method</Label>
              <Select value={form.method} onValueChange={(value) => handleChange('method', value)}>
                <SelectTrigger id="method">
                  <SelectValue placeholder="Select delivery" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="call">Phone call</SelectItem>
                  <SelectItem value="in-person">In-person</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="location">Location / instructions</Label>
              <Input
                id="location"
                placeholder="123 Main St courthouse lobby"
                value={form.location || ''}
                onChange={(event) => handleChange('location', event.target.value)}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Additional instructions or escalation notes"
                value={form.notes || ''}
                onChange={(event) => handleChange('notes', event.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Reminders</p>
                <p className="text-xs text-slate-500">Send email/SMS reminders before the check-in.</p>
              </div>
              <Switch
                className="border border-slate-300"
                checked={form.remindersEnabled}
                onCheckedChange={(checked) => handleChange('remindersEnabled', Boolean(checked))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">GPS tracking</p>
                <p className="text-xs text-slate-500">Ping client device up to three times per day.</p>
              </div>
              <Switch
                className="border border-slate-300"
                checked={form.gpsEnabled}
                onCheckedChange={(checked) => handleChange('gpsEnabled', Boolean(checked))}
              />
            </div>

            {form.gpsEnabled ? (
              <div className="space-y-2">
                <Label htmlFor="pingsPerDay">Pings per day</Label>
                <Input
                  id="pingsPerDay"
                  type="number"
                  min={1}
                  max={6}
                  value={form.pingsPerDay}
                  onChange={(event) => handleChange('pingsPerDay', Number(event.target.value) || 1)}
                />
                <p className="text-xs text-slate-500">Default is 3. Clients are notified before each ping.</p>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save check-in'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CheckInFormModal;
