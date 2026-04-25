import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Search,
  Filter,
  Download,
  Eye,
  Calendar,
  CreditCard,
  DollarSign,
  TrendingUp,
  CheckCircle,
  Clock,
  XCircle,
} from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { usePaymentMetrics, usePayments } from '../../hooks/payments';

const STATUS_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'pending', label: 'Pending' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
  { id: 'refunded', label: 'Refunded' },
  { id: 'disputed', label: 'Disputed' },
];

function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

export function PaymentHistory({ onNavigate }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState('30');

  const { data: metricsData } = usePaymentMetrics();
  const { data: paymentsData, isLoading } = usePayments({
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: searchTerm.trim() || undefined,
  });

  const currency = metricsData?.summary?.totalRevenue?.currency || 'USD';
  const transactions = useMemo(() => paymentsData?.items ?? [], [paymentsData]);

  const monthlyStats = useMemo(() => {
    const totalRevenue = transactions
      .filter((payment) => payment.status === 'completed')
      .reduce((sum, payment) => sum + payment.amount, 0);
    const totalTransactions = transactions.length;
    const successDenominator = transactions.filter((payment) => ['completed', 'failed'].includes(payment.status)).length;
    const successRate = successDenominator === 0
      ? 100
      : (transactions.filter((payment) => payment.status === 'completed').length / successDenominator) * 100;
    const averageAmount = totalTransactions === 0 ? 0 : totalRevenue / totalTransactions;
    return { totalRevenue, totalTransactions, successRate, averageAmount };
  }, [transactions]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'pending':
      case 'processing':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start space-x-4">
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
              <h1 className="text-3xl text-foreground mb-1">Payment History</h1>
              <p className="text-muted-foreground">
                View and manage all payment transactions
              </p>
            </div>
          </div>
          <PillButton size="md" className="mt-1 px-6 text-sm" disabled>
            <Download className="h-5 w-5 mr-2" />
            Export Report
          </PillButton>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <Badge variant="default" className="px-2 py-0.5 text-xs">{metricsData ? `${(metricsData.summary.totalRevenue.changeRatio * 100).toFixed(1)}%` : '—'}</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-2xl">{formatCurrency(monthlyStats.totalRevenue, currency)}</p>
                <p className="text-sm">Total Revenue</p>
                <p className="text-xs text-muted-foreground">This Month</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary" className="px-2 py-0.5 text-xs">{transactions.length}</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-2xl">{transactions.length}</p>
                <p className="text-sm">Transactions</p>
                <p className="text-xs text-muted-foreground">This View</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <Badge variant="default" className="px-2 py-0.5 text-xs">{monthlyStats.successRate.toFixed(1)}%</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-2xl">{monthlyStats.successRate.toFixed(1)}%</p>
                <p className="text-sm">Success Rate</p>
                <p className="text-xs text-muted-foreground">Filtered Results</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="px-2 py-0.5 text-xs">Avg</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-2xl">{formatCurrency(monthlyStats.averageAmount, currency)}</p>
                <p className="text-sm">Average Amount</p>
                <p className="text-xs text-muted-foreground">Per Transaction</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search client, case, or transaction"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
                <PillButton variant="outline" size="default" disabled>
                  <Filter className="h-4 w-4 mr-2" />
                  Advanced filters
                </PillButton>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transactions Table */}
        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>
              {isLoading ? 'Loading transactions…' : `${transactions.length} payment${transactions.length === 1 ? '' : 's'} in view`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Loading transactions…
                    </TableCell>
                  </TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No transactions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{transaction.transactionId}</p>
                          <p className="text-xs text-muted-foreground">{transaction.bondNumber || '—'}</p>
                          <p className="text-xs text-muted-foreground">{new Date(transaction.createdAt || '').toLocaleString()}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm">{transaction.clientName || '—'}</p>
                          <p className="text-xs text-muted-foreground">{transaction.clientEmail || '—'}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm">{formatCurrency(transaction.amount, transaction.currency || currency)}</p>
                          {transaction.fees ? (
                            <p className="text-xs text-muted-foreground">Fees: {formatCurrency(transaction.fees, transaction.currency || currency)}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{transaction.method}</TableCell>
                      <TableCell>
                        <StatusChip status={transaction.status}>
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(transaction.status)}
                            <span className="capitalize">{transaction.status}</span>
                          </div>
                        </StatusChip>
                      </TableCell>
                      <TableCell className="text-right">
                        <PillButton size="sm" variant="ghost" onClick={() => onNavigate('payment-confirmation')}>
                          <Eye className="h-4 w-4 mr-2" />
                          Details
                        </PillButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
