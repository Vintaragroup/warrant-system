import React, { useState } from 'react';
import { Shield, AlertTriangle, Users, Activity, ArrowLeft, Download, Calendar, Filter, Bell } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { UserAvatar, UserAvatarMenu } from '../ui/user-avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { useUser } from '../UserContext';
import type { AuthScreen } from './types';

interface AuthAuditProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AuthAudit({ onNavigate }: AuthAuditProps) {
  const { currentUser, users, signOut } = useUser();
  const [timeRange, setTimeRange] = useState('7d');
  const [eventFilter, setEventFilter] = useState('all');

  if (!currentUser) return null;

  // Mock audit data
  const auditEvents = [
    {
      id: '1',
      timestamp: '2024-01-20 14:32:15',
      event: 'failed_login',
      user: 'sarah.johnson@bailbonds.com',
      details: 'Invalid password attempt',
      ipAddress: '192.168.1.100',
      userAgent: 'Chrome 120.0 (macOS)',
      location: 'Los Angeles, CA',
      severity: 'medium'
    },
    {
      id: '2',
      timestamp: '2024-01-20 14:30:22',
      event: 'successful_login',
      user: 'mike.rodriguez@bailbonds.com',
      details: 'Login via Google OAuth',
      ipAddress: '10.0.0.45',
      userAgent: 'Safari 17.0 (iOS)',
      location: 'Riverside, CA',
      severity: 'low'
    },
    {
      id: '3',
      timestamp: '2024-01-20 13:45:10',
      event: 'mfa_reset',
      user: 'lisa.chen@bailbonds.com',
      details: 'MFA device removed by admin',
      ipAddress: '192.168.1.200',
      userAgent: 'Chrome 120.0 (Windows)',
      location: 'Orange County, CA',
      severity: 'high'
    },
    {
      id: '4',
      timestamp: '2024-01-20 12:15:33',
      event: 'account_lockout',
      user: 'jennifer.walsh@bailbonds.com',
      details: '5 consecutive failed login attempts',
      ipAddress: '203.0.113.45',
      userAgent: 'Firefox 121.0 (Windows)',
      location: 'Unknown',
      severity: 'high'
    },
    {
      id: '5',
      timestamp: '2024-01-20 11:22:18',
      event: 'password_change',
      user: 'david.thompson@bailbonds.com',
      details: 'Password changed successfully',
      ipAddress: '192.168.1.150',
      userAgent: 'Chrome 120.0 (macOS)',
      location: 'Los Angeles, CA',
      severity: 'medium'
    },
    {
      id: '6',
      timestamp: '2024-01-20 10:45:07',
      event: 'role_change',
      user: 'admin@bailbonds.com',
      details: 'User role changed from Agent to Supervisor (target: mike.rodriguez@bailbonds.com)',
      ipAddress: '192.168.1.10',
      userAgent: 'Chrome 120.0 (macOS)',
      location: 'Los Angeles, CA',
      severity: 'high'
    }
  ];

  const getEventColor = (event: string) => {
    switch (event) {
      case 'successful_login': return 'success';
      case 'failed_login': return 'error';
      case 'account_lockout': return 'error';
      case 'mfa_reset': return 'error';
      case 'password_change': return 'pending';
      case 'role_change': return 'pending';
      default: return 'inactive';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatEventName = (event: string) => {
    return event.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const stats = {
    totalEvents: auditEvents.length,
    failedLogins: auditEvents.filter(e => e.event === 'failed_login').length,
    lockedAccounts: auditEvents.filter(e => e.event === 'account_lockout').length,
    mfaResets: auditEvents.filter(e => e.event === 'mfa_reset').length
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Header */}
      <div className="bg-white border-b border-accent">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg">BailBonds Dashboard</h2>
            </div>
            <div className="flex items-center space-x-4">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <UserAvatarMenu
                user={currentUser}
                size="md"
                showStatus
                onProfileClick={() => onNavigate('profile-settings')}
                onSettingsClick={() => console.log('Settings clicked')}
                onSignOutClick={async () => {
                  await signOut();
                  onNavigate('landing');
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => onNavigate('admin-users')}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Users
            </button>
            <div>
              <h1 className="text-2xl text-foreground flex items-center">
                <Shield className="h-6 w-6 mr-3" />
                Authentication Audit & Alerts
              </h1>
              <p className="text-muted-foreground">
                Monitor security events, failed logins, and suspicious activities
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <PillButton variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export Report
            </PillButton>
          </div>
        </div>

        {/* Alert Banner */}
        <Alert className="mb-8 border-destructive/50 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive">
            <strong>Security Alert:</strong> 3 failed login attempts detected in the last hour. 
            <button className="underline hover:no-underline ml-1">View details</button>
          </AlertDescription>
        </Alert>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Events (7d)</p>
                  <p className="text-2xl">{stats.totalEvents}</p>
                  <div className="flex items-center mt-2">
                    <div className="h-1 bg-primary rounded-full w-16 mr-2" />
                    <span className="text-xs text-success">+12% vs last week</span>
                  </div>
                </div>
                <Activity className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Failed Logins</p>
                  <p className="text-2xl text-destructive">{stats.failedLogins}</p>
                  <div className="flex items-center mt-2">
                    <div className="h-1 bg-destructive rounded-full w-12 mr-2" />
                    <span className="text-xs text-destructive">-5% vs last week</span>
                  </div>
                </div>
                <AlertTriangle className="h-8 w-8 text-destructive/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Account Lockouts</p>
                  <p className="text-2xl text-yellow-600">{stats.lockedAccounts}</p>
                  <div className="flex items-center mt-2">
                    <div className="h-1 bg-yellow-600 rounded-full w-8 mr-2" />
                    <span className="text-xs text-yellow-600">Same as last week</span>
                  </div>
                </div>
                <Users className="h-8 w-8 text-yellow-600/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">MFA Resets</p>
                  <p className="text-2xl">{stats.mfaResets}</p>
                  <div className="flex items-center mt-2">
                    <div className="h-1 bg-blue-600 rounded-full w-6 mr-2" />
                    <span className="text-xs text-blue-600">+1 this week</span>
                  </div>
                </div>
                <Shield className="h-8 w-8 text-blue-600/60" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground mb-2 block">Search events</label>
                <Input placeholder="Search by user, IP, or event details..." />
              </div>
              <div className="flex gap-2">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Time Range</label>
                  <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger className="w-32">
                      <Calendar className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1d">Last 24h</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="90d">Last 90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Event Type</label>
                  <Select value={eventFilter} onValueChange={setEventFilter}>
                    <SelectTrigger className="w-36">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Events</SelectItem>
                      <SelectItem value="login">Login Events</SelectItem>
                      <SelectItem value="security">Security Events</SelectItem>
                      <SelectItem value="admin">Admin Actions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Audit Log Table */}
        <Card>
          <CardHeader>
            <CardTitle>Security Audit Log</CardTitle>
            <CardDescription>
              Detailed log of authentication and security events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <div className="text-sm">
                        <div>{event.timestamp.split(' ')[0]}</div>
                        <div className="text-muted-foreground text-xs">
                          {event.timestamp.split(' ')[1]}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={getEventColor(event.event)}>
                        {formatEventName(event.event)}
                      </StatusChip>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <UserAvatar 
                          user={users.find(u => u.email === event.user) || {
                            id: '0',
                            name: event.user.split('@')[0],
                            email: event.user,
                            role: 'Agent',
                            avatarColor: 'slate'
                          }}
                          size="xs" 
                        />
                        <div className="text-sm">
                          {event.user.split('@')[0]}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm max-w-xs">
                        <div>{event.details}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {event.ipAddress} • {event.userAgent.split(' ')[0]}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {event.location}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={getSeverityColor(event.severity)}>
                        {event.severity}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
