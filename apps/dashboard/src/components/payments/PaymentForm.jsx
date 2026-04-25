import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CreditCard,
  DollarSign,
  Shield,
  Check,
  Calculator,
  FileText,
} from 'lucide-react';
import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { useCreatePayment, usePaymentMethods } from '../../hooks/payments';
import { useToast } from '../ToastContext';
import { hasStripeKey } from '../../lib/stripeClient';
import { useNavigate } from 'react-router-dom';

const PAYMENT_TYPE_LABELS = {
  bond: 'Bond Payment',
  partial: 'Partial Payment',
  fee: 'Service Fee',
  premium: 'Premium Payment',
};

function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

function getMethodLabel(method) {
  if (!method) return 'Select a method';
  if (method.type === 'card') {
    return `${(method.brand || 'Card').toUpperCase()} •••• ${method.last4 || '0000'}`;
  }
  if (method.type === 'bank_account') {
    return `${method.bankName || 'Bank'} •••• ${method.last4 || '0000'}`;
  }
  return method.label || method.id;
}

function getMethodFeeHint(method) {
  if (!method) return '';
  if (method.type === 'card') return 'Estimated processing fee: 2.9%';
  if (method.type === 'bank_account') return 'Estimated processing fee: 0.8% (ACH)';
  if (method.type === 'wire') return 'Wire transfer – manual confirmation required';
  return method.type;
}

export function PaymentForm({ onNavigate }) {
  const [paymentType, setPaymentType] = useState('bond');
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const { data: methodsData, isLoading: methodsLoading } = usePaymentMethods();
  const createPayment = useCreatePayment();
  const { pushToast } = useToast();
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const navigate = useNavigate();

  const paymentMethods = useMemo(() => methodsData?.methods ?? [], [methodsData]);
  const selectedMethod = paymentMethods.find((method) => method.id === selectedMethodId);
  const methodLabel = useMemo(() => {
    if (hasStripeKey) return 'Stripe Card Entry';
    return selectedMethod ? getMethodLabel(selectedMethod) : 'Select a method';
  }, [selectedMethod]);

  useEffect(() => {
    if (!hasStripeKey && !selectedMethodId && paymentMethods.length) {
      setSelectedMethodId(paymentMethods[0].id);
    }
  }, [paymentMethods, selectedMethodId]);

  const numericAmount = parseFloat(amount) || 0;
  const processingFee = numericAmount ? numericAmount * 0.029 : 0;
  const serviceFee = numericAmount ? 2.5 : 0;
  const totalAmount = numericAmount + processingFee + serviceFee;

  const handleSubmit = async () => {
    if (!numericAmount || !clientName || (hasStripeKey && !clientEmail)) {
      pushToast({
        variant: 'error',
        title: 'Missing details',
        message: hasStripeKey
          ? 'Provide client name, email, and amount before processing.'
          : 'Fill out client name and amount before processing.',
      });
      return;
    }

    if (hasStripeKey && (!stripe || !elements)) {
      pushToast({
        variant: 'error',
        title: 'Stripe not ready',
        message: 'Stripe Elements is still loading. Please try again in a moment.',
      });
      return;
    }

    setProcessing(true);
    try {
      const response = await createPayment.mutateAsync({
        amount: numericAmount,
        currency: 'usd',
        method: selectedMethod?.type || 'card',
        clientName,
        clientEmail: clientEmail || undefined,
        paymentType,
        description: notes || undefined,
        metadata: {
          caseNumber: caseNumber || undefined,
          notes: notes || undefined,
          paymentType,
          serviceFee,
          processingFee,
        },
      });

      const clientSecret = response?.clientSecret;

      if (hasStripeKey && clientSecret) {
        const cardElement = elements?.getElement(CardElement);
        if (!cardElement || !stripe) {
          throw new Error('Stripe input is not ready yet.');
        }

        const confirmation = await stripe.confirmCardPayment(clientSecret, {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: clientName,
              email: clientEmail || undefined,
            },
          },
        });

        if (confirmation.error) {
          throw new Error(confirmation.error.message || 'Card confirmation failed');
        }
      }

      pushToast({ variant: 'success', title: 'Payment submitted', message: 'Payment is being processed.' });
      setAmount('');
      setClientName('');
      setClientEmail('');
      setCaseNumber('');
      setNotes('');
      setAcceptTerms(false);
      if (!hasStripeKey && paymentMethods.length) {
        setSelectedMethodId(paymentMethods[0].id);
      }
      if (elements) {
        const cardElement = elements.getElement(CardElement);
        cardElement?.clear();
      }
      const transactionId = response?.payment?.transactionId;
      if (transactionId) {
        navigate(`/payments/confirmation?transactionId=${encodeURIComponent(transactionId)}`, {
          replace: true,
          state: { transactionId },
        });
      } else {
        onNavigate('payment-confirmation');
      }
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Unable to process payment',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-6xl">
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
              <h1 className="text-3xl text-foreground mb-2">Process Payment</h1>
              <p className="text-muted-foreground">Collect bond payments and fees from clients</p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <FileText className="h-5 w-5 mr-2" /> Payment Details
                </CardTitle>
                <CardDescription>Select the payment type and enter client information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label className="text-sm">Payment Type</Label>
                  <RadioGroup value={paymentType} onValueChange={setPaymentType} className="mt-3">
                    {Object.entries(PAYMENT_TYPE_LABELS).map(([value, label]) => (
                      <div key={value} className="flex items-center space-x-3 py-2">
                        <RadioGroupItem value={value} id={`payment-${value}`} />
                        <Label htmlFor={`payment-${value}`}>{label}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="client-name" className="text-sm">Client Name *</Label>
                    <Input
                      id="client-name"
                      value={clientName}
                      onChange={(event) => setClientName(event.target.value)}
                      placeholder="Enter client's full name"
                      className="mt-2 h-10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="case-number" className="text-sm">Case Number</Label>
                    <Input
                      id="case-number"
                      value={caseNumber}
                      onChange={(event) => setCaseNumber(event.target.value)}
                      placeholder="BB-2024-001"
                      className="mt-2 h-10"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="amount" className="text-sm">Payment Amount *</Label>
                  <div className="relative mt-2">
                    <DollarSign className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="amount"
                      type="number"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0.00"
                      className="pl-10 h-10"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="client-email" className="text-sm">Client Email {hasStripeKey ? '*' : ''}</Label>
                  <Input
                    id="client-email"
                    type="email"
                    value={clientEmail}
                    onChange={(event) => setClientEmail(event.target.value)}
                    placeholder="client@example.com"
                    className="mt-2 h-10"
                  />
                  {hasStripeKey ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      Used for Stripe receipts and verification.
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor="notes" className="text-sm">Payment Notes</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Additional notes about this payment..."
                    rows={3}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <CreditCard className="h-5 w-5 mr-2" /> Payment Method
                </CardTitle>
                <CardDescription>Choose how the client will pay.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasStripeKey ? (
                  <>
                    <div className="border rounded-lg px-4 py-3">
                      <CardElement
                        options={{
                          style: {
                            base: {
                              color: '#0f172a',
                              fontSize: '16px',
                              '::placeholder': { color: '#94a3b8' },
                            },
                            invalid: { color: '#dc2626' },
                          },
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Test card: <code>4242 4242 4242 4242</code>, any future expiry, any CVC.
                    </p>
                  </>
                ) : methodsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading payment methods…</p>
                ) : paymentMethods.length ? (
                  <RadioGroup value={selectedMethodId} onValueChange={setSelectedMethodId}>
                    {paymentMethods.map((method) => (
                      <div key={method.id} className="flex items-center space-x-3 p-4 border rounded-lg">
                        <RadioGroupItem value={method.id} id={method.id} />
                        <Label htmlFor={method.id} className="flex-1 cursor-pointer">
                          <div className="flex items-center justify-between">
                            <span>{getMethodLabel(method)}</span>
                            <Badge variant="secondary" className="text-xs px-2 py-1 ml-4 capitalize">
                              {method.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{getMethodFeeHint(method)}</p>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No payment methods available. Configure Stripe or add methods in the management screen.
                  </p>
                )}

                {!hasStripeKey && (
                  <div className="pt-4 border-t">
                    <PillButton variant="outline" size="sm" onClick={() => onNavigate('payment-methods')}>
                      Manage Payment Methods
                    </PillButton>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Shield className="h-5 w-5 mr-2" /> Security & Terms
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="border-blue-200 bg-blue-50">
                  <Shield className="h-4 w-4 text-primary" />
                  <AlertDescription>
                    This payment will be processed securely using 256-bit SSL encryption. Your payment information is
                    protected and PCI DSS compliant.
                  </AlertDescription>
                </Alert>

                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="terms"
                    checked={acceptTerms}
                    onCheckedChange={(checked) => setAcceptTerms(Boolean(checked))}
                  />
                  <Label htmlFor="terms" className="text-sm leading-relaxed">
                    I acknowledge that this payment is for bail bond services and understand the terms and conditions. I confirm
                    the payment amount and client information is correct.
                  </Label>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Calculator className="h-5 w-5 mr-2" /> Payment Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Payment Type:</span>
                    <span className="capitalize">{PAYMENT_TYPE_LABELS[paymentType]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Client:</span>
                    <span>{clientName || 'Not specified'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Email:</span>
                    <span>{clientEmail || 'Not provided'}</span>
                  </div>
                  {caseNumber ? (
                    <div className="flex justify-between">
                      <span>Case:</span>
                      <span>{caseNumber}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span>Method:</span>
                    <span>{methodLabel}</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Payment Amount:</span>
                    <span>{formatCurrency(numericAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Processing Fee:</span>
                    <span>{formatCurrency(processingFee)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Service Fee:</span>
                    <span>{formatCurrency(serviceFee)}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between text-base font-medium">
                  <span>Total Amount:</span>
                  <span>{formatCurrency(totalAmount)}</span>
                </div>

                <PillButton
                  className="w-full mt-6"
                  disabled={
                    !numericAmount ||
                    !clientName ||
                    !acceptTerms ||
                    processing ||
                    createPayment.isLoading ||
                    (hasStripeKey ? !clientEmail : !selectedMethod)
                  }
                  onClick={handleSubmit}
                >
                  <Check className="h-4 w-4 mr-2" />
                  {processing || createPayment.isLoading ? 'Processing…' : 'Process Payment'}
                </PillButton>

                <p className="text-xs text-muted-foreground text-center">Payment will be processed immediately.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
