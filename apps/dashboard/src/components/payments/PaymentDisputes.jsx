import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  MessageSquare,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  Phone,
  Mail,
} from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Textarea } from '../ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Separator } from '../ui/separator';
import { Label } from '../ui/label';
import { usePaymentDisputes, useResolveDispute } from '../../hooks/payments';
import { useToast } from '../ToastContext';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'needs_response', label: 'Needs Response' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'resolved', label: 'Resolved' },
];

export function PaymentDisputes({ onNavigate }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [responseNotes, setResponseNotes] = useState('');
  const { data, isLoading } = usePaymentDisputes();
  const resolveDispute = useResolveDispute();
  const { pushToast } = useToast();

  const disputes = useMemo(() => {
    const items = data?.items ?? [];
    if (statusFilter === 'all') return items;
    return items.filter((item) => item.status === statusFilter);
  }, [data, statusFilter]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'needs_response':
        return 'error';
      case 'under_review':
        return 'pending';
      case 'resolved':
      case 'closed':
        return 'success';
      default:
        return 'inactive';
    }
  };

  const handleResolve = async () => {
    if (!selectedDispute) return;
    try {
      await resolveDispute.mutateAsync({
        id: selectedDispute.id,
        payload: responseNotes ? { notes: responseNotes } : undefined,
      });
      pushToast({ variant: 'success', title: 'Response submitted', message: 'Dispute updated successfully.' });
      setSelectedDispute(null);
      setResponseNotes('');
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Unable to update dispute',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
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
              <h1 className="text-3xl text-foreground mb-2">Payment Disputes</h1>
              <p className="text-muted-foreground">
                Manage payment disputes and chargebacks
              </p>
            </div>
          </div>
        </div>

        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="mb-6">
          <TabsList className="flex flex-wrap">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="mr-2 mb-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={statusFilter} className="outline-none">
            <Card>
              <CardHeader>
                <CardTitle>Dispute Queue</CardTitle>
                <CardDescription>
                  {isLoading ? 'Loading disputes…' : `${disputes.length} dispute${disputes.length === 1 ? '' : 's'} in view`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispute</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          Loading disputes…
                        </TableCell>
                      </TableRow>
                    ) : disputes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          No disputes in this view.
                        </TableCell>
                      </TableRow>
                    ) : (
                      disputes.map((dispute) => (
                        <TableRow key={dispute.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{dispute.id}</p>
                              <p className="text-xs text-muted-foreground">TXN {dispute.transactionId}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="text-sm">{dispute.client}</p>
                              <p className="text-xs text-muted-foreground">{dispute.reason}</p>
                            </div>
                          </TableCell>
                          <TableCell>{`$${dispute.amount.toLocaleString()}`}</TableCell>
                          <TableCell>{new Date(dispute.openedAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <StatusChip status={getStatusColor(dispute.status)}>{dispute.status}</StatusChip>
                          </TableCell>
                          <TableCell className="text-right">
                            <PillButton size="sm" variant="ghost" onClick={() => setSelectedDispute(dispute)}>
                              View
                            </PillButton>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {selectedDispute ? (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center space-x-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <span>Dispute {selectedDispute.id}</span>
                  </CardTitle>
                  <CardDescription>{selectedDispute.client}</CardDescription>
                </div>
                <div className="flex items-center space-x-3">
                  <Badge variant="secondary">Due {selectedDispute.responseDeadline ? new Date(selectedDispute.responseDeadline).toLocaleDateString() : '—'}</Badge>
                  <StatusChip status={getStatusColor(selectedDispute.status)}>{selectedDispute.status}</StatusChip>
                  <PillButton variant="outline" size="sm" onClick={() => setSelectedDispute(null)}>
                    Close
                  </PillButton>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2 text-sm">
                  <p><strong>Transaction:</strong> {selectedDispute.transactionId}</p>
                  <p><strong>Amount:</strong> ${selectedDispute.amount.toLocaleString()}</p>
                  <p><strong>Reason:</strong> {selectedDispute.reason}</p>
                  <p><strong>Opened:</strong> {new Date(selectedDispute.openedAt).toLocaleString()}</p>
                </div>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p><Phone className="inline h-4 w-4 mr-2" /> Contact customer to verify claim.</p>
                  <p><Mail className="inline h-4 w-4 mr-2" /> Gather signed documentation supporting the charge.</p>
                  <p><FileText className="inline h-4 w-4 mr-2" /> Upload evidence before the response deadline.</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label htmlFor="dispute-response" className="text-sm font-medium">Response notes</Label>
                <Textarea
                  id="dispute-response"
                  placeholder="Summarize the outcome, attach evidence links, or provide additional context."
                  value={responseNotes}
                  onChange={(event) => setResponseNotes(event.target.value)}
                  rows={4}
                />
                <div className="flex justify-end gap-2">
                  <PillButton variant="outline" onClick={() => setSelectedDispute(null)}>
                    Cancel
                  </PillButton>
                  <PillButton onClick={handleResolve} disabled={resolveDispute.isLoading}>
                    {resolveDispute.isLoading ? 'Submitting…' : 'Submit response'}
                  </PillButton>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Alert className="mt-8 border-blue-200 bg-blue-50">
          <AlertDescription>
            Track chargebacks closely—provide evidence within the gateway’s deadline to avoid automatic losses.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
