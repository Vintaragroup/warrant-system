import React, { useState } from 'react';
import { User, Shield, Smartphone, Chrome, Apple, Trash2, Plus, MapPin, Calendar, LogOut, Bell, Settings, ArrowLeft } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { UserAvatar, UserAvatarMenu } from '../ui/user-avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { useUser } from '../UserContext';
import type { AuthScreen } from './types';

interface ProfileSettingsProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function ProfileSettings({ onNavigate }: ProfileSettingsProps) {
  const { currentUser, signOut } = useUser();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);

  if (!currentUser) return null;

  const linkedProviders = [
    { id: 'google', name: 'Google', email: 'agent@bailbonds.com', icon: Chrome, connected: true },
    { id: 'apple', name: 'Apple ID', email: 'agent@icloud.com', icon: Apple, connected: false },
  ];

  const mfaDevices = [
    { id: '1', name: 'iPhone 13', type: 'SMS', number: '+1 (555) ***-1234', active: true, lastUsed: '2 days ago' },
    { id: '2', name: 'Authenticator App', type: 'TOTP', device: 'Google Authenticator', active: true, lastUsed: 'Today' },
  ];

  const activeSessions = [
    { id: '1', device: 'MacBook Pro', location: 'Los Angeles, CA', lastActive: '5 minutes ago', current: true },
    { id: '2', device: 'iPhone 13', location: 'Los Angeles, CA', lastActive: '2 hours ago', current: false },
    { id: '3', device: 'Windows PC', location: 'Orange County, CA', lastActive: '1 day ago', current: false },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Header */}
      <div className="bg-white border-b border-accent">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => onNavigate('landing')}
                className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </button>
              <h2 className="text-lg">BailBonds Dashboard</h2>
            </div>
            <div className="flex items-center space-x-4">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <UserAvatarMenu
                user={currentUser}
                size="md"
                showStatus
                onProfileClick={() => console.log('Profile clicked')}
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

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl text-foreground">Profile & Security Settings</h1>
            <p className="text-muted-foreground">
              Manage your account preferences and security settings
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <PillButton variant="outline" onClick={() => onNavigate('admin-users')}>
              Admin Panel
            </PillButton>
          </div>
        </div>

        {/* Profile Summary Card */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="flex items-start space-x-6">
              <UserAvatar user={currentUser} size="2xl" showStatus />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl">{currentUser.name}</h3>
                    <p className="text-muted-foreground">{currentUser.email}</p>
                    <Badge className="mt-2 capitalize">{currentUser.role}</Badge>
                  </div>
                  <PillButton variant="outline" size="sm" onClick={() => onNavigate('avatar-showcase')}>
                    <Settings className="h-4 w-4 mr-2" />
                    Customize Avatar
                  </PillButton>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-6">
                  <div className="text-center">
                    <p className="text-2xl">24</p>
                    <p className="text-sm text-muted-foreground">Active Cases</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl">5</p>
                    <p className="text-sm text-muted-foreground">Counties</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl">98%</p>
                    <p className="text-sm text-muted-foreground">Success Rate</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Settings */}
          <div className="lg:col-span-2 space-y-6">
            {/* Profile Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <User className="h-5 w-5 mr-2" />
                  Profile Information
                </CardTitle>
                <CardDescription>
                  Update your personal information and contact details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <Input id="firstName" defaultValue={currentUser.name.split(' ')[0]} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" defaultValue={currentUser.name.split(' ')[1] || ''} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input id="email" type="email" defaultValue={currentUser.email} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input id="phone" type="tel" defaultValue="+1 (555) 123-4567" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="license">Bail Agent License #</Label>
                  <Input id="license" defaultValue="BA-2024-8851" />
                </div>
                <div className="flex justify-end pt-4">
                  <PillButton>Save Changes</PillButton>
                </div>
              </CardContent>
            </Card>

            {/* Linked Providers */}
            <Card>
              <CardHeader>
                <CardTitle>Connected Accounts</CardTitle>
                <CardDescription>
                  Manage your social login providers for easier access
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {linkedProviders.map((provider) => (
                  <div key={provider.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <provider.icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm">{provider.name}</p>
                        <p className="text-xs text-muted-foreground">{provider.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <StatusChip status={provider.connected ? 'active' : 'inactive'}>
                        {provider.connected ? 'Connected' : 'Not Connected'}
                      </StatusChip>
                      <PillButton 
                        variant={provider.connected ? 'outline' : 'primary'} 
                        size="sm"
                      >
                        {provider.connected ? 'Disconnect' : 'Connect'}
                      </PillButton>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* MFA Devices */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center">
                      <Shield className="h-5 w-5 mr-2" />
                      Two-Factor Authentication
                    </CardTitle>
                    <CardDescription>
                      Manage your MFA devices for enhanced security
                    </CardDescription>
                  </div>
                  <PillButton size="sm" onClick={() => onNavigate('mfa-enrollment')}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Device
                  </PillButton>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {mfaDevices.map((device) => (
                  <div key={device.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <Smartphone className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="flex items-center space-x-2">
                          <p className="text-sm">{device.name}</p>
                          <Badge variant="secondary">{device.type}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {device.type === 'SMS' ? device.number : device.device} • Last used {device.lastUsed}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <StatusChip status={device.active ? 'active' : 'inactive'}>
                        {device.active ? 'Active' : 'Inactive'}
                      </StatusChip>
                      <PillButton variant="outline" size="sm">
                        <Trash2 className="h-3 w-3" />
                      </PillButton>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Notification Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>
                  Choose how you want to be notified
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-notifications">Email notifications</Label>
                    <p className="text-xs text-muted-foreground">Case updates, court dates</p>
                  </div>
                  <Switch 
                    id="email-notifications"
                    checked={emailNotifications}
                    onCheckedChange={setEmailNotifications}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="sms-notifications">SMS notifications</Label>
                    <p className="text-xs text-muted-foreground">Urgent alerts only</p>
                  </div>
                  <Switch 
                    id="sms-notifications"
                    checked={smsNotifications}
                    onCheckedChange={setSmsNotifications}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Active Sessions */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Active Sessions</CardTitle>
                  <PillButton variant="outline" size="sm">
                    Sign Out All
                  </PillButton>
                </div>
                <CardDescription>
                  Devices currently signed in to your account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {activeSessions.map((session) => (
                  <div key={session.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm">{session.device}</p>
                        {session.current && (
                          <Badge variant="secondary" className="text-xs">Current</Badge>
                        )}
                      </div>
                      {!session.current && (
                        <button className="text-xs text-destructive hover:underline">
                          Sign out
                        </button>
                      )}
                    </div>
                    <div className="flex items-center text-xs text-muted-foreground space-x-1">
                      <MapPin className="h-3 w-3" />
                      <span>{session.location}</span>
                      <span>•</span>
                      <span>{session.lastActive}</span>
                    </div>
                    {session.id !== activeSessions[activeSessions.length - 1].id && (
                      <Separator className="mt-3" />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Danger Zone */}
            <Card className="border-destructive/20">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>
                  Actions that can't be undone
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="border-destructive/50 bg-destructive/5">
                  <AlertDescription className="text-destructive text-sm">
                    These actions will immediately affect your account access and data.
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <PillButton variant="outline" className="w-full text-destructive border-destructive hover:bg-destructive hover:text-white">
                    Sign Out Everywhere
                  </PillButton>
                  <PillButton variant="outline" className="w-full text-destructive border-destructive hover:bg-destructive hover:text-white">
                    Delete Account
                  </PillButton>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
