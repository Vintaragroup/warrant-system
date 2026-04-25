import React, { useEffect, useState } from 'react';
import { ArrowLeft, Settings, CreditCard, Shield, Bell } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { usePaymentSettings, useUpdatePaymentSettings } from '../../hooks/payments';
import { useToast } from '../ToastContext';

const DEFAULT_SETTINGS = {
  defaultMethodId: '',
  acceptedMethods: ['card', 'ach_debit', 'wire', 'check'],
  autoCapture: true,
  autoCaptureDelayMinutes: 15,
  receiptEmailEnabled: true,
  approvalThreshold: 5000,
  twoPersonApproval: true,
  notifyOnLargePayment: true,
  notifyRecipients: ['billing@example.com'],
  automationRules: [],
};

export function PaymentSettings({ onNavigate }) {
  const { data, isLoading } = usePaymentSettings();
  const updateSettings = useUpdatePaymentSettings();
  const { pushToast } = useToast();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [recipients, setRecipients] = useState(settings.notifyRecipients.join(', '));

  useEffect(() => {
    if (data?.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      setRecipients((data.settings.notifyRecipients || []).join(', '));
    }
  }, [data]);

  const handleToggle = (field) => (checked) => {
    setSettings((prev) => ({ ...prev, [field]: checked }));
  };

  const handleChange = (field) => (event) => {
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        ...settings,
        notifyRecipients: recipients
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      pushToast({
        variant: 'success',
        title: 'Settings saved',
        message: 'Payment preferences updated successfully.',
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Unable to save settings',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-5xl">
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start space-x-6">
            <PillButton
              variant="ghost"
              size="sm"
              onClick={() => onNavigate('billing-dashboard')}
              className="mt-1"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Billing
            </PillButton>
            <div>
              <h1 className="text-3xl text-foreground mb-2">Payment Settings</h1>
              <p className="text-muted-foreground">
                Configure payment processing and notification preferences
              </p>
            </div>
          </div>
          <PillButton onClick={handleSave} disabled={updateSettings.isLoading || isLoading}>
            {updateSettings.isLoading ? 'Saving…' : 'Save Changes'}
          </PillButton>
        </div>

        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" /> Payment Preferences
              </CardTitle>
              <CardDescription>Defaults for capturing payments and accepted tenders.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-capture payments</p>
                  <p className="text-xs text-muted-foreground">Automatically capture card funds after authorization.</p>
                </div>
                <Switch checked={settings.autoCapture} onCheckedChange={handleToggle('autoCapture')} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="capture-delay" className="text-xs text-muted-foreground">Capture delay (minutes)</Label>
                  <Input
                    id="capture-delay"
                    type="number"
                    min={0}
                    value={settings.autoCaptureDelayMinutes ?? 0}
                    onChange={handleChange('autoCaptureDelayMinutes')}
                    disabled={!settings.autoCapture}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="approval-threshold" className="text-xs text-muted-foreground">Manager approval threshold ($)</Label>
                  <Input
                    id="approval-threshold"
                    type="number"
                    min={0}
                    value={settings.approvalThreshold ?? 0}
                    onChange={handleChange('approvalThreshold')}
                    className="mt-2"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" /> Security & Approvals
              </CardTitle>
              <CardDescription>Strengthen controls for high-value and risky payments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Require dual approval</p>
                  <p className="text-xs text-muted-foreground">Two team members must approve payments above the threshold.</p>
                </div>
                <Switch checked={settings.twoPersonApproval} onCheckedChange={handleToggle('twoPersonApproval')} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Send automatic receipts</p>
                  <p className="text-xs text-muted-foreground">Email clients a receipt after each processed payment.</p>
                </div>
                <Switch checked={settings.receiptEmailEnabled} onCheckedChange={handleToggle('receiptEmailEnabled')} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" /> Notifications & Alerts
              </CardTitle>
              <CardDescription>Stay informed about payment events that need your attention.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Alert on large payments</p>
                  <p className="text-xs text-muted-foreground">Notify the billing team when a payment exceeds the threshold.</p>
                </div>
                <Switch checked={settings.notifyOnLargePayment} onCheckedChange={handleToggle('notifyOnLargePayment')} />
              </div>

              <div>
                <Label htmlFor="recipients" className="text-xs text-muted-foreground">Notification recipients</Label>
                <Textarea
                  id="recipients"
                  value={recipients}
                  onChange={(event) => setRecipients(event.target.value)}
                  placeholder="billing@example.com, finance@example.com"
                  className="mt-2"
                  rows={2}
                />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated list of emails.</p>
              </div>
            </CardContent>
          </Card>

          <Alert className="border-blue-200 bg-blue-50">
            <AlertDescription>
              Updating these settings will immediately affect payment workflows for all team members.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
