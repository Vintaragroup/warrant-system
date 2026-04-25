import React, { useState } from 'react';
import { ArrowLeft, Settings, Bell, Search, Menu, Plus, MoreHorizontal } from 'lucide-react';
import { UserAvatar, UserAvatarMenu } from './ui/user-avatar';
import { AvatarCustomizer } from './AvatarCustomizer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { PillButton } from './ui/pill-button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { useUser } from './UserContext';
import type { AuthScreen } from './auth/types';

interface AvatarShowcaseProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AvatarShowcase({ onNavigate }: AvatarShowcaseProps) {
  const { currentUser, users, updateUserProfile } = useUser();
  const [showCustomizer, setShowCustomizer] = useState(false);

  if (!currentUser) return null;

  if (showCustomizer) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <AvatarCustomizer
          user={currentUser}
          onSave={(updates) => {
            updateUserProfile(currentUser.id, updates);
            setShowCustomizer(false);
          }}
          onCancel={() => setShowCustomizer(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => onNavigate('design-guide')}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Design Guide
            </button>
            <div>
              <h1 className="text-2xl text-foreground">User Avatar Showcase</h1>
              <p className="text-muted-foreground">
                Avatar placement patterns and customization options
              </p>
            </div>
          </div>
          <PillButton onClick={() => setShowCustomizer(true)}>
            Customize Avatar
          </PillButton>
        </div>

        <div className="space-y-8">
          {/* 1. Header/Navigation Bar Example */}
          <Card>
            <CardHeader>
              <CardTitle>1. Navigation Header Placement</CardTitle>
              <CardDescription>
                Standard placement in top navigation with dropdown menu
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-white border border-accent rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Menu className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg">BailBonds Dashboard</h2>
                  </div>
                  <div className="flex items-center space-x-4">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <Bell className="h-5 w-5 text-muted-foreground" />
                    <UserAvatarMenu
                      user={currentUser}
                      size="md"
                      showStatus
                      onProfileClick={() => console.log('Profile clicked')}
                      onSettingsClick={() => console.log('Settings clicked')}
                      onSignOutClick={() => console.log('Sign out clicked')}
                    />
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                <strong>Usage:</strong> Primary navigation, always visible on logged-in screens. 
                Shows online status and provides quick access to profile/settings.
              </p>
            </CardContent>
          </Card>

          {/* 2. Profile Card Example */}
          <Card>
            <CardHeader>
              <CardTitle>2. Profile Card Placement</CardTitle>
              <CardDescription>
                Large avatar in profile sections and user details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-6">
                <div className="flex items-start space-x-6">
                  <UserAvatar user={currentUser} size="2xl" showStatus />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl">{currentUser.name}</h3>
                        <p className="text-muted-foreground">{currentUser.email}</p>
                        <Badge className="mt-2 capitalize">{currentUser.role}</Badge>
                      </div>
                      <PillButton variant="outline" size="sm">
                        <Settings className="h-4 w-4 mr-2" />
                        Edit Profile
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
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                <strong>Usage:</strong> Profile pages, user detail views, onboarding screens. 
                Prominent display with status indicator and related information.
              </p>
            </CardContent>
          </Card>

          {/* 3. Data Table Example */}
          <Card>
            <CardHeader>
              <CardTitle>3. Data Table Placement</CardTitle>
              <CardDescription>
                Small avatars in user listings and data tables
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.slice(0, 4).map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          <UserAvatar user={user} size="sm" />
                          <div>
                            <p className="text-sm">{user.name}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{user.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-2 bg-green-500 rounded-full" />
                          <span className="text-sm">Online</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">2 hours ago</span>
                      </TableCell>
                      <TableCell>
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground mt-4">
                <strong>Usage:</strong> User management tables, team member lists, activity logs. 
                Compact display with essential user identification.
              </p>
            </CardContent>
          </Card>

          {/* 4. Chat/Comments Example */}
          <Card>
            <CardHeader>
              <CardTitle>4. Communication Placement</CardTitle>
              <CardDescription>
                Avatars in chat interfaces, comments, and activity feeds
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <UserAvatar user={users[1]} size="sm" />
                  <div className="flex-1 bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm">{users[1].name}</span>
                      <span className="text-xs text-muted-foreground">2:30 PM</span>
                    </div>
                    <p className="text-sm">Case #BB-2024-001 has been updated. Client payment received.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <UserAvatar user={users[2]} size="sm" />
                  <div className="flex-1 bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm">{users[2].name}</span>
                      <span className="text-xs text-muted-foreground">2:45 PM</span>
                    </div>
                    <p className="text-sm">Thanks for the update! I'll process the release paperwork.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <UserAvatar user={currentUser} size="sm" />
                  <div className="flex-1">
                    <Input placeholder="Type a message..." className="w-full" />
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                <strong>Usage:</strong> Chat interfaces, comment threads, activity feeds, notifications. 
                Shows conversation participants with timestamps.
              </p>
            </CardContent>
          </Card>

          {/* 5. Size Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>5. Size Guidelines</CardTitle>
              <CardDescription>
                Different avatar sizes and their recommended use cases
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex items-center space-x-6">
                  <UserAvatar user={currentUser} size="xs" />
                  <div>
                    <p className="text-sm"><strong>Extra Small (24px)</strong></p>
                    <p className="text-xs text-muted-foreground">
                      Inline mentions, tiny user indicators, status dots
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <UserAvatar user={currentUser} size="sm" />
                  <div>
                    <p className="text-sm"><strong>Small (32px)</strong></p>
                    <p className="text-xs text-muted-foreground">
                      Table rows, comment threads, compact lists, chat messages
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <UserAvatar user={currentUser} size="md" showStatus />
                  <div>
                    <p className="text-sm"><strong>Medium (40px)</strong></p>
                    <p className="text-xs text-muted-foreground">
                      Navigation headers, dropdown triggers, standard UI elements
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <UserAvatar user={currentUser} size="lg" showStatus />
                  <div>
                    <p className="text-sm"><strong>Large (48px)</strong></p>
                    <p className="text-xs text-muted-foreground">
                      User cards, prominent listings, featured content
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <UserAvatar user={currentUser} size="xl" showStatus />
                  <div>
                    <p className="text-sm"><strong>Extra Large (64px)</strong></p>
                    <p className="text-xs text-muted-foreground">
                      Profile sections, onboarding, welcome screens
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <UserAvatar user={currentUser} size="2xl" showStatus />
                  <div>
                    <p className="text-sm"><strong>2X Large (80px)</strong></p>
                    <p className="text-xs text-muted-foreground">
                      Profile headers, account setup, hero sections
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 6. Customization Options */}
          <Card>
            <CardHeader>
              <CardTitle>6. Customization Examples</CardTitle>
              <CardDescription>
                Different avatar styles showing various customization options
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {users.map((user) => (
                  <div key={user.id} className="text-center space-y-3">
                    <UserAvatar user={user} size="lg" showStatus />
                    <div>
                      <p className="text-sm">{user.name.split(' ')[0]}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {user.avatarIcon} • {user.avatarColor}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                <h4 className="text-sm mb-2">Customization Options:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• <strong>Profile Image:</strong> Upload custom photo (JPG, PNG up to 2MB)</li>
                  <li>• <strong>Icons:</strong> Choose from 6 professional icons (shield, crown, star, etc.)</li>
                  <li>• <strong>Colors:</strong> Select from 14 brand-appropriate colors</li>
                  <li>• <strong>Initials:</strong> Auto-generated or custom 2-letter combinations</li>
                  <li>• <strong>Status:</strong> Online, offline, away, busy indicators</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
