import React, { useMemo } from 'react';
import {
  ArrowLeft,
  CreditCard,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  Filter,
  Search,
} from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { UserAvatar } from '../ui/user-avatar';
import { useUser } from '../UserContext';
import {
  usePaymentDisputes,
  usePaymentMetrics,
  usePayments,
  useRefundEligible,
} from '../../hooks/payments';

function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function BillingDashboard({ onNavigate }) {
  const { currentUser } = useUser();
  const { data: metricsData, isLoading: metricsLoading } = usePaymentMetrics();
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments();
  const { data: refundEligible } = useRefundEligible();
  const { data: disputesData } = usePaymentDisputes();

  const currency = metricsData?.summary?.totalRevenue?.currency || 'USD';

  const metrics = useMemo(() => {
    if (!metricsData) {
      return [
        { title: 'Total Revenue', value: '—', change: null, trend: 'neutral', icon: DollarSign, description: 'This month' },
        { title: 'Active Bonds', value: '—', change: null, trend: 'neutral', icon: CreditCard, description: 'Currently processing' },
        { title: 'Payment Success Rate', value: '—', change: null, trend: 'neutral', icon: TrendingUp, description: 'Last 30 days' },
        { title: 'Pending Payments', value: '—', change: null, trend: 'neutral', icon: Clock, description: 'Awaiting processing' },
      ];
    }
    const { summary } = metricsData;
    return [
      {
        title: 'Total Revenue',
        value: formatCurrency(summary.totalRevenue.value, currency),
        change: `${(summary.totalRevenue.changeRatio * 100).toFixed(1)}%`,
        trend: summary.totalRevenue.changeRatio >= 0 ? 'up' : 'down',
        icon: DollarSign,
        description: summary.totalRevenue.label,
      },
      {
        title: 'Active Bonds',
        value: summary.activeBonds.value.toLocaleString(),
        change: summary.activeBonds.change >= 0 ? `+${summary.activeBonds.change}` : `${summary.activeBonds.change}`,
        trend: summary.activeBonds.change >= 0 ? 'up' : 'down',
        icon: CreditCard,
        description: summary.activeBonds.label,
      },
      {
        title: 'Payment Success Rate',
        value: `${(summary.successRate.value * 100).toFixed(1)}%`,
        change: `${(summary.successRate.change * 100).toFixed(1)}%`,
        trend: summary.successRate.change >= 0 ? 'up' : 'down',
        icon: TrendingUp,
        description: summary.successRate.label,
      },
      {
        title: 'Pending Payments',
        value: summary.pendingPayments.value.toLocaleString(),
        change: summary.pendingPayments.change >= 0 ? `+${summary.pendingPayments.change}` : `${summary.pendingPayments.change}`,
        trend: summary.pendingPayments.change >= 0 ? 'up' : 'down',
        icon: Clock,
        description: summary.pendingPayments.label,
      },
    ];
  }, [metricsData, currency]);

  const recentTransactions = useMemo(() => {
    const items = paymentsData?.items ?? [];
    return items.slice(0, 5).map((payment) => ({
      id: payment.transactionId,
      client: payment.clientName || '—',
      amount: formatCurrency(payment.amount, payment.currency || currency),
      type: payment.flags?.[0]?.replace('-', ' ') || 'Payment',
      status: payment.status,
      date: formatDate(payment.processedAt || payment.createdAt),
      method: payment.method,
    }));
  }, [paymentsData, currency]);

  const pendingRefundCount = refundEligible?.items?.length ?? 0;
  const activeDisputes = disputesData?.items?.filter((item) => item.status !== 'resolved' && item.status !== 'closed').length ?? 0;

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
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
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
              onClick={() => onNavigate('landing')}
              className="mt-1"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </PillButton>
            <div>
              <h1 className="text-3xl text-foreground mb-2">Billing & Payments</h1>
              <p className="text-muted-foreground">
                Manage client payments, bonds, and billing operations
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {currentUser && <UserAvatar user={currentUser} size="md" showStatus />}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <Card key={metric.title}>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <Badge
                      variant={metric.trend === 'up' ? 'default' : metric.trend === 'down' ? 'destructive' : 'secondary'}
                      className="px-3 py-1"
                    >
                      {metricsLoading || metric.change === null ? '—' : metric.change}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-2xl font-semibold">{metricsLoading ? '—' : metric.value}</p>
                    <p className="text-sm text-muted-foreground">{metric.title}</p>
                    <p className="text-xs text-muted-foreground">{metric.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Recent Transactions */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Transactions</CardTitle>
                    <CardDescription>
                      Latest payment activity and bond transactions
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input placeholder="Search transactions..." className="pl-10 w-64 h-10" readOnly />
                    </div>
                    <PillButton variant="outline" size="default" disabled>
                      <Filter className="h-4 w-4 mr-2" />
                      Filter
                    </PillButton>
                  </div>
                </div>
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
                      <TableHead className="text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentsLoading && recentTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          Loading transactions…
                        </TableCell>
                      </TableRow>
                    ) : recentTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          No recent transactions.
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentTransactions.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              <Badge variant="outline" className="capitalize">
                                {transaction.type}
                              </Badge>
                              <span className="text-sm text-muted-foreground">{transaction.id}</span>
                            </div>
                          </TableCell>
                          <TableCell>{transaction.client}</TableCell>
                          <TableCell>{transaction.amount}</TableCell>
                          <TableCell className="capitalize">{transaction.method}</TableCell>
                          <TableCell>
                            <StatusChip status={transaction.status}>
                              <div className="flex items-center space-x-2">
                                {getStatusIcon(transaction.status)}
                                <span className="capitalize">{transaction.status}</span>
                              </div>
                            </StatusChip>
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{transaction.date}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common payment and billing tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <PillButton className="w-full justify-start" variant="outline" onClick={() => onNavigate('payment-form')}>
                Process Payment
              </PillButton>
              <PillButton className="w-full justify-start" variant="outline" onClick={() => onNavigate('refund-processing')}>
                Pending Refunds ({pendingRefundCount})
              </PillButton>
              <PillButton className="w-full justify-start" variant="outline" onClick={() => onNavigate('payment-methods')}>
                Manage Payment Methods
              </PillButton>
              <PillButton className="w-full justify-start" variant="outline" onClick={() => onNavigate('payment-disputes')}>
                Handle Disputes ({activeDisputes})
              </PillButton>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Payment Alerts</CardTitle>
              <CardDescription>Items requiring attention</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {metricsData?.alerts?.length ? (
                metricsData.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-lg border-l-4 px-4 py-3 ${
                      alert.severity === 'warning'
                        ? 'border-amber-400 bg-amber-50'
                        : alert.severity === 'error'
                          ? 'border-rose-400 bg-rose-50'
                          : 'border-blue-400 bg-blue-50'
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No alerts at this time.</p>
              )}
              <div className="flex gap-2 pt-2">
                <PillButton variant="outline" size="sm" className="flex-1" onClick={() => onNavigate('payment-history')}>
                  View all activity
                </PillButton>
                <PillButton variant="ghost" size="sm" onClick={() => onNavigate('payment-settings')}>
                  Payment settings
                </PillButton>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming Payouts</CardTitle>
              <CardDescription>Automatic settlements</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {metricsData?.upcomingPayouts?.length ? (
                metricsData.upcomingPayouts.map((payout) => (
                  <div key={payout.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p>{payout.id}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDate(payout.arrivalDate)} • {payout.method.toUpperCase()}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-blue-200 text-blue-600 capitalize">
                      {payout.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No upcoming payouts scheduled.</p>
              )}
              <PillButton variant="outline" size="sm" className="w-full" onClick={() => onNavigate('payment-history')}>
                <Download className="h-4 w-4 mr-2" />
                Export payouts
              </PillButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Alerts & Resources</CardTitle>
              <CardDescription>Latest updates from the billing team</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>• Reconcile daily Stripe payouts with internal ledger (auto task).</p>
              <p>• ACH payments settle in 3-5 business days; monitor pending queue.</p>
              <PillButton variant="ghost" size="sm" className="px-0" onClick={() => onNavigate('payment-settings')}>
                Review billing controls
              </PillButton>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
