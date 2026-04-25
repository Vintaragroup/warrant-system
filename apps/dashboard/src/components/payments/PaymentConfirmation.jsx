import React from 'react';
import { CheckCircle, Download, Send, Copy, CreditCard, Calendar, User, FileText, DollarSign, ArrowLeft } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription } from '../ui/alert';
import { usePaymentDetail } from '../../hooks/payments';
import { useLocation } from 'react-router-dom';

function useTransactionId() {
  const location = useLocation();
  const data = location.state && typeof location.state === 'object' ? location.state : {};
  if (data.transactionId) return data.transactionId;
  const searchParams = new URLSearchParams(location.search);
  return searchParams.get('transactionId') || '';
}

function formatCurrency(amount, currency = 'USD') {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function PaymentConfirmation({ onNavigate }) {
  const transactionId = useTransactionId();
  const { data, isLoading } = usePaymentDetail(transactionId);
  const payment = data?.payment;

  const readMeta = (key) => {
    if (!payment?.metadata) return undefined;
    const source = payment.metadata;
    if (typeof source.get === 'function') return source.get(key);
    return source[key];
  };

  const amount = payment?.amount ?? 0;
  const processingFee = Number(readMeta('processingFee') ?? payment?.fees ?? 0);
  const serviceFee = Number(readMeta('serviceFee') ?? 0);
  const total = amount + processingFee + serviceFee;
  const receiptNumber = readMeta('receiptNumber') || transactionId;
  const paymentType = readMeta('paymentType') || 'Payment';
  const processedAt = payment?.processedAt || payment?.createdAt || new Date().toISOString();
  const last4 = readMeta('last4') || 'XXXX';
  const paymentMethod = payment?.method ? `${payment.method.toUpperCase()} •••• ${last4}` : 'Stripe Card Entry';

  if (!transactionId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle>Payment Confirmation</CardTitle>
            <CardDescription>No payment details were provided.</CardDescription>
          </CardHeader>
          <CardContent>
            <PillButton variant="outline" onClick={() => onNavigate('billing-dashboard')}>
              Return to Billing Dashboard
            </PillButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    // In a real app, you'd show a toast notification
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
          </div>
          <h1 className="text-3xl text-foreground mb-2">Payment Successful!</h1>
          <p className="text-muted-foreground">
            The payment has been processed successfully and a receipt has been generated.
          </p>
        </div>

        {/* Payment Confirmation Card */}
        <Card className="mb-8">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl">Payment Confirmation</CardTitle>
            <CardDescription className="text-lg">
              Transaction ID: {transactionId || '—'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Transaction Details */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Client</p>
                    <p className="text-base">{isLoading ? 'Loading…' : (payment?.clientName || '—')}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Case Number</p>
                    <p>{isLoading ? 'Loading…' : (payment?.bondNumber || '—')}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Payment Type</p>
                    <Badge variant="secondary" className="mt-1 capitalize">{paymentType}</Badge>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <CreditCard className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Payment Method</p>
                    <p>{isLoading ? 'Loading…' : paymentMethod}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Processed</p>
                    <p>{isLoading ? 'Loading…' : new Date(processedAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge className="bg-success text-success-foreground mt-1 capitalize">{payment?.status || (isLoading ? 'processing' : 'completed')}</Badge>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Payment Breakdown */}
            <div>
              <h3 className="text-sm text-muted-foreground mb-3">Payment Breakdown</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Payment Amount</span>
                  <span>{formatCurrency(amount, payment?.currency)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Processing Fee (2.9%)</span>
                  <span>+{formatCurrency(processingFee, payment?.currency)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Service Fee</span>
                  <span>+{formatCurrency(serviceFee, payment?.currency)}</span>
                </div>
                <Separator className="my-3" />
                <div className="flex justify-between pt-1">
                  <span>Total Paid</span>
                  <span>{formatCurrency(total, payment?.currency)}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Receipt Information */}
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="text-sm">Receipt Number</p>
                <p className="text-sm text-muted-foreground">{receiptNumber || '—'}</p>
              </div>
              <PillButton 
                variant="outline" 
                size="sm"
                onClick={() => copyToClipboard(receiptNumber)}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </PillButton>
            </div>
          </CardContent>
        </Card>

        {/* Success Alert */}
        <Alert className="mb-6 border-success/20 bg-success/5">
          <CheckCircle className="h-4 w-4 text-success" />
          <AlertDescription>
            <strong>Payment Processed Successfully!</strong> The client has been notified and the payment 
            has been recorded in the case file. A receipt has been automatically generated and saved.
          </AlertDescription>
        </Alert>

        {/* Actions */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Receipt & Documentation</CardTitle>
              <CardDescription>
                Download or send payment documentation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <PillButton className="w-full justify-center">
                <Download className="h-4 w-4 mr-2" />
                Download Receipt
              </PillButton>
              <PillButton variant="outline" className="w-full justify-center">
                <Send className="h-4 w-4 mr-2" />
                Email to Client
              </PillButton>
              <PillButton variant="outline" className="w-full justify-center">
                <FileText className="h-4 w-4 mr-2" />
                Add to Case File
              </PillButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Next Steps</CardTitle>
              <CardDescription>
                Continue with payment processing or case management
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <PillButton 
                variant="outline" 
                className="w-full justify-center"
                onClick={() => onNavigate('payment-form')}
              >
                Process Another Payment
              </PillButton>
              <PillButton 
                variant="outline" 
                className="w-full justify-center"
                onClick={() => onNavigate('payment-history')}
              >
                View Payment History
              </PillButton>
              <PillButton 
                variant="outline" 
                className="w-full justify-center"
                onClick={() => onNavigate('billing-dashboard')}
              >
                Back to Billing Dashboard
              </PillButton>
            </CardContent>
          </Card>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-center space-x-4">
          <button 
            onClick={() => onNavigate('billing-dashboard')}
            className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
