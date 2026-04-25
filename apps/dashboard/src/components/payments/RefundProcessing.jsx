import React, { useMemo, useState } from 'react';
import { ArrowLeft, Search, RotateCcw, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { useRefundEligible, useRefundRequests, useSubmitRefund } from '../../hooks/payments';
import { useToast } from '../ToastContext';

function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

export function RefundProcessing({ onNavigate }) {
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const { data: eligible, isLoading: eligibleLoading } = useRefundEligible();
  const { data: requests, isLoading: requestsLoading } = useRefundRequests();
  const submitRefund = useSubmitRefund();
  const { pushToast } = useToast();

  const eligibleTransactions = useMemo(() => eligible?.items ?? [], [eligible]);

  const handleRefundSubmit = async () => {
    if (!selectedTransaction) return;
    const amountValue = Number(refundAmount || selectedTransaction.refundableAmount);
    if (!amountValue || Number.isNaN(amountValue)) {
      pushToast({ variant: 'error', title: 'Invalid amount', message: 'Enter a valid refund amount.' });
      return;
    }
    try {
      await submitRefund.mutateAsync({
        id: selectedTransaction.id,
        payload: {
          amount: amountValue,
          reason: refundReason || undefined,
        },
      });
      pushToast({ variant: 'success', title: 'Refund queued', message: 'Refund request submitted for processing.' });
      setShowRefundModal(false);
      setSelectedTransaction(null);
      setRefundAmount('');
      setRefundReason('');
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Unable to submit refund',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'eligible':
        return 'success';
      case 'partial_refund':
        return 'pending';
      case 'processing':
      case 'approved':
        return 'pending';
      case 'completed':
        return 'success';
      default:
        return 'inactive';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8">
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
              <h1 className="text-3xl text-foreground mb-2">Refund Processing</h1>
              <p className="text-muted-foreground">
                Process refunds for bond payments and fees
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Eligible Refunds */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Eligible for Refund</CardTitle>
                    <CardDescription>
                      Transactions that can be refunded
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input placeholder="Search transactions..." className="pl-9 w-64 h-10" readOnly />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Original Amount</TableHead>
                      <TableHead>Refundable</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eligibleLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          Loading eligible transactions…
                        </TableCell>
                      </TableRow>
                    ) : eligibleTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          No transactions currently eligible for refund.
                        </TableCell>
                      </TableRow>
                    ) : (
                      eligibleTransactions.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell>
                            <div>
                              <p className="text-sm">{transaction.id}</p>
                              <p className="text-xs text-muted-foreground">
                                {transaction.caseNumber || '—'} • {transaction.daysAgo} days ago
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm">{transaction.client}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm">{formatCurrency(transaction.originalAmount)}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm">{formatCurrency(transaction.refundableAmount)}</p>
                          </TableCell>
                          <TableCell>
                            <StatusChip status={getStatusColor(transaction.status)}>
                              {transaction.status.replace('_', ' ')}
                            </StatusChip>
                          </TableCell>
                          <TableCell>
                            <Dialog open={showRefundModal && selectedTransaction?.id === transaction.id} onOpenChange={(open) => {
                              setShowRefundModal(open);
                              if (!open) {
                                setSelectedTransaction(null);
                                setRefundAmount('');
                                setRefundReason('');
                              }
                            }}>
                              <DialogTrigger asChild>
                                <PillButton
                                  size="sm"
                                  onClick={() => {
                                    setSelectedTransaction(transaction);
                                    setRefundAmount(transaction.refundableAmount.toString());
                                  }}
                                >
                                  <RotateCcw className="h-4 w-4 mr-2" />
                                  Refund
                                </PillButton>
                              </DialogTrigger>
                              <DialogContent className="max-w-md">
                                <DialogHeader>
                                  <DialogTitle>Process Refund</DialogTitle>
                                  <DialogDescription>
                                    Issue a refund for transaction {selectedTransaction?.id}
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 pt-4">
                                  <div>
                                    <Label htmlFor="refund-amount" className="text-xs text-muted-foreground">Refund amount</Label>
                                    <Input
                                      id="refund-amount"
                                      type="number"
                                      min={0}
                                      value={refundAmount}
                                      onChange={(event) => setRefundAmount(event.target.value)}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor="refund-reason" className="text-xs text-muted-foreground">Reason</Label>
                                    <Textarea
                                      id="refund-reason"
                                      value={refundReason}
                                      onChange={(event) => setRefundReason(event.target.value)}
                                      placeholder="Optional notes for finance team"
                                      rows={3}
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <PillButton variant="outline" onClick={() => setShowRefundModal(false)}>
                                      Cancel
                                    </PillButton>
                                    <PillButton onClick={handleRefundSubmit} disabled={submitRefund.isLoading}>
                                      {submitRefund.isLoading ? 'Submitting…' : 'Submit Refund'}
                                    </PillButton>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Refund Activity */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Workflow Alerts</CardTitle>
                <CardDescription>Outstanding tasks from the billing team</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Alert variant="default" className="border-amber-200 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription>
                    Review documentation for case BB-2024-331 before approving the partial refund.
                  </AlertDescription>
                </Alert>
                <Alert variant="default" className="border-blue-200 bg-blue-50">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription>
                    ACH refund STRP-RF-9841 scheduled for settlement tomorrow.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pending Refunds</CardTitle>
                <CardDescription>Requests awaiting completion</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {requestsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading refund requests…</p>
                ) : (requests?.items ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending refunds.</p>
                ) : (
                  requests.items.map((item) => (
                    <div key={item.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{item.client}</p>
                        <StatusChip status={item.status}>{item.status}</StatusChip>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.transactionId}</p>
                      <p className="text-xs text-muted-foreground">Requested {new Date(item.requestedAt).toLocaleString()}</p>
                      <p className="text-sm">Amount: {formatCurrency(item.amount)}</p>
                      {item.reason ? <p className="text-xs text-muted-foreground">Reason: {item.reason}</p> : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
