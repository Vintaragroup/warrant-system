import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CreditCard,
  Plus,
  Trash2,
  Edit,
  Shield,
} from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useCreatePaymentMethod, usePaymentMethods } from '../../hooks/payments';
import { useToast } from '../ToastContext';

export function PaymentMethods({ onNavigate }) {
  const [showAddCard, setShowAddCard] = useState(false);
  const [form, setForm] = useState({
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: '12',
    expiryYear: '2026',
    label: 'Business Account',
    isDefault: false,
  });
  const { data, isLoading } = usePaymentMethods();
  const createMethod = useCreatePaymentMethod();
  const { pushToast } = useToast();

  const paymentMethods = useMemo(() => data?.methods ?? [], [data]);

  const getCardIcon = () => {
    return <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden />;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return <Badge variant="secondary" className="text-success">Active</Badge>;
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>;
      case 'disabled':
        return <Badge variant="outline">Disabled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleSubmit = async () => {
    try {
      await createMethod.mutateAsync({
        type: form.type,
        brand: form.brand,
        last4: form.last4,
        expiryMonth: Number(form.expiryMonth) || undefined,
        expiryYear: Number(form.expiryYear) || undefined,
        label: form.label,
        isDefault: form.isDefault,
      });
      setShowAddCard(false);
      pushToast({
        variant: 'success',
        title: 'Payment method added',
        message: `${form.type === 'card' ? 'Card' : 'Bank account'} added successfully`,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Unable to add method',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  };

  const handleInputChange = (field) => (event) => {
    const value = event?.target ? event.target.value : event;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-5xl">
        {/* Header */}
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
              <h1 className="text-3xl text-foreground mb-2">Payment Methods</h1>
              <p className="text-muted-foreground">
                Manage your payment methods for client transactions
              </p>
            </div>
          </div>
          <Dialog open={showAddCard} onOpenChange={setShowAddCard}>
            <DialogTrigger asChild>
              <PillButton size="sm" className="h-9">
                <Plus className="h-4 w-4 mr-2" />
                Add Payment Method
              </PillButton>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Payment Method</DialogTitle>
                <DialogDescription>
                  Add a new credit card or bank account for processing payments
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="method-type">Payment Method Type</Label>
                  <Select value={form.type} onValueChange={(value) => setForm((prev) => ({ ...prev, type: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select method type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="card">Credit Card</SelectItem>
                      <SelectItem value="bank_account">Bank Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.type === 'card' ? (
                  <>
                    <div>
                      <Label htmlFor="card-brand">Card Brand</Label>
                      <Input id="card-brand" value={form.brand} onChange={handleInputChange('brand')} placeholder="Visa" />
                    </div>
                    <div>
                      <Label htmlFor="card-number">Last four digits</Label>
                      <Input id="card-number" value={form.last4} onChange={handleInputChange('last4')} placeholder="4242" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="expiry-month">Expiry Month</Label>
                        <Input id="expiry-month" value={form.expiryMonth} onChange={handleInputChange('expiryMonth')} placeholder="12" />
                      </div>
                      <div>
                        <Label htmlFor="expiry-year">Expiry Year</Label>
                        <Input id="expiry-year" value={form.expiryYear} onChange={handleInputChange('expiryYear')} placeholder="2026" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="bank-name">Bank Name</Label>
                      <Input id="bank-name" value={form.label} onChange={handleInputChange('label')} placeholder="First National Bank" />
                    </div>
                    <div>
                      <Label htmlFor="bank-last4">Account last four digits</Label>
                      <Input id="bank-last4" value={form.last4} onChange={handleInputChange('last4')} placeholder="7890" />
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="method-label">Display Label</Label>
                  <Input id="method-label" value={form.label} onChange={handleInputChange('label')} placeholder="Business Account" />
                </div>
                <div className="flex items-center space-x-2 text-sm">
                  <input
                    id="default-method"
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(event) => setForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
                  />
                  <Label htmlFor="default-method">Set as default method</Label>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <PillButton variant="outline" onClick={() => setShowAddCard(false)} disabled={createMethod.isLoading}>
                    Cancel
                  </PillButton>
                  <PillButton onClick={handleSubmit} disabled={createMethod.isLoading}>
                    {createMethod.isLoading ? 'Saving…' : 'Add Payment Method'}
                  </PillButton>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Security Notice */}
        <Alert className="mb-6 border-blue-200 bg-blue-50">
          <Shield className="h-4 w-4 text-primary" />
          <AlertDescription>
            <strong>Secure Payment Processing:</strong> All payment methods are encrypted and stored securely.
            We use industry-standard PCI DSS compliance to protect your financial information.
          </AlertDescription>
        </Alert>

        {/* Payment Methods List */}
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">Loading payment methods…</CardContent>
            </Card>
          ) : paymentMethods.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No payment methods yet.</CardContent>
            </Card>
          ) : (
            paymentMethods.map((method) => (
              <Card key={method.id} className={method.status === 'expired' ? 'border-destructive/20' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center justify-center w-12 h-9 bg-muted rounded border">
                        {getCardIcon(method.brand)}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <p className="text-sm">
                            {method.type === 'card'
                              ? `${method.brand?.toUpperCase() || 'Card'} •••• ${method.last4 || '0000'}`
                              : `${method.bankName || 'Bank'} •••• ${method.last4 || '0000'}`}
                          </p>
                          {method.isDefault && (
                            <Badge className="px-2 py-0.5 text-xs">Default</Badge>
                          )}
                          {getStatusBadge(method.status)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {method.label || '—'}
                          {method.type === 'card' && method.expiryMonth && method.expiryYear
                            ? ` • Exp ${method.expiryMonth}/${method.expiryYear}`
                            : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <PillButton size="sm" variant="ghost" disabled>
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </PillButton>
                      <PillButton size="sm" variant="ghost" disabled>
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </PillButton>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
