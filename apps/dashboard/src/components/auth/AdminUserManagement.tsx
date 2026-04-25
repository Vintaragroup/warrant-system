import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Plus,
  Search,
  Shield,
  UserCheck,
  UserX,
  Mail,
  Calendar,
  ArrowLeft,
  Bell,
  RotateCcw,
  Inbox,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { useUser } from '../UserContext';
import { useToast } from '../ToastContext';
import type { AuthScreen } from './types';
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useRevokeUser,
  type UserAccount,
} from '../../hooks/users';
import {
  useAccessRequests,
  useUpdateAccessRequest,
  type AccessRequest,
  type AccessRequestStatus,
} from '../../hooks/accessRequests';
import { useMetadataWithFallback } from '../../hooks/metadata';

const STATUS_OPTIONS: UserAccount['status'][] = ['active', 'suspended', 'invited', 'pending_mfa', 'deleted'];

function parseList(input: string): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function statusLabel(status: UserAccount['status']) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'suspended':
      return 'Suspended';
    case 'invited':
      return 'Invited';
    case 'pending_mfa':
      return 'Pending MFA';
    case 'deleted':
      return 'Deleted';
    default:
      return status;
  }
}

function statusBadgeTone(status: UserAccount['status']) {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-800';
    case 'suspended':
    case 'deleted':
      return 'bg-rose-100 text-rose-700';
    case 'pending_mfa':
      return 'bg-amber-100 text-amber-800';
    case 'invited':
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

interface AdminUserManagementProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AdminUserManagement({ onNavigate }: AdminUserManagementProps) {
  const { currentUser, signOut } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | UserAccount['status']>('all');
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserAccount | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    displayName: '',
    role: 'Employee',
    departments: '',
    counties: '',
  });
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteStep, setInviteStep] = useState<'form' | 'confirm' | 'result'>('form');
  const [inviteOutcome, setInviteOutcome] = useState<{ ok: boolean; email: string; link?: string; emailed?: boolean; error?: string } | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<AccessRequestStatus | 'all'>('pending');
  const { pushToast } = useToast();
  const {
    metadata,
    isLoading: metadataLoading,
    isError: metadataError,
  } = useMetadataWithFallback();
  const roleOptions = metadata.roles;
  const countyOptions = metadata.counties;
  const departmentOptions = metadata.departments;

  useEffect(() => {
    if (!roleOptions.length) return;
    setInviteForm((prev) => {
      if (prev.role && roleOptions.includes(prev.role)) {
        return prev;
      }
      const fallbackRole = roleOptions.includes('Employee')
        ? 'Employee'
        : roleOptions.includes('BondClient')
          ? 'BondClient'
          : roleOptions[0];
      if (!fallbackRole) return prev;
      return { ...prev, role: fallbackRole };
    });
  }, [roleOptions]);

  const filters = useMemo(
    () => ({
      role: roleFilter === 'all' ? undefined : roleFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: searchQuery ? searchQuery.trim() : undefined,
    }),
    [roleFilter, statusFilter, searchQuery]
  );

  const {
    data: users = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useUsers(filters);

  const combinedRoleOptions = useMemo(() => {
    const set = new Set(roleOptions);
    users?.forEach((user) => {
      user.roles?.forEach((role) => set.add(role));
    });
    return Array.from(set);
  }, [roleOptions, users]);

  const countySet = useMemo(() => {
    return new Set(countyOptions.map((value) => value.toLowerCase()));
  }, [countyOptions]);

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    departmentOptions.forEach((value) => {
      map.set(value.toLowerCase(), value);
    });
    return map;
  }, [departmentOptions]);

  const departmentSet = useMemo(() => new Set(departmentMap.keys()), [departmentMap]);

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const revokeUser = useRevokeUser();
  const {
    data: accessRequests = [],
    isLoading: accessLoading,
    isError: accessError,
    error: accessErrorObj,
  } = useAccessRequests(requestStatusFilter);
  const updateAccessRequest = useUpdateAccessRequest();

  const canManageUsers = currentUser?.roles?.includes('SuperUser') || currentUser?.roles?.includes('Admin') || currentUser?.roles?.includes('DepartmentLead');

  const filteredUsers = users;

  const handleInvite = async () => {
    try {
      const requestedDepartments = parseList(inviteForm.departments);
      const requestedCounties = parseList(inviteForm.counties).map((value) => value.toLowerCase());

      const invalidDepartments = departmentSet.size
        ? requestedDepartments.filter((value) => !departmentSet.has(value.toLowerCase()))
        : [];
      if (invalidDepartments.length) {
        const message = `Unknown departments: ${invalidDepartments.join(', ')}`;
        setInviteResult(message);
        pushToast({
          variant: 'error',
          title: 'Invalid departments',
          message,
        });
        return;
      }

      const invalidCounties = countySet.size
        ? requestedCounties.filter((value) => !countySet.has(value))
        : [];
      if (invalidCounties.length) {
        const message = `Unknown counties: ${invalidCounties.join(', ')}`;
        setInviteResult(message);
        pushToast({
          variant: 'error',
          title: 'Invalid counties',
          message,
        });
        return;
      }

      const normalizedDepartments = departmentSet.size
        ? requestedDepartments.map((value) => departmentMap.get(value.toLowerCase()) ?? value)
        : requestedDepartments;

      const payload = {
        email: inviteForm.email,
        displayName: inviteForm.displayName,
        roles: [inviteForm.role],
        departments: normalizedDepartments,
        counties: requestedCounties,
      };
      const result = await createUser.mutateAsync(payload);
      const link = result?.inviteLink as string | undefined;
      const emailed = Boolean(result?.emailed);
      setInviteOutcome({ ok: true, email: payload.email, link, emailed });
      setInviteResult(link || 'Invite created');
      pushToast({
        variant: 'success',
        title: 'Invitation sent',
        message: emailed ? `An email was sent to ${payload.email}.` : `Invite link generated for ${payload.email}.`,
      });
      setInviteStep('result');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to invite user';
      setInviteResult(message);
      setInviteOutcome({ ok: false, email: inviteForm.email, error: message });
      setInviteStep('result');
      pushToast({
        variant: 'error',
        title: 'Invite failed',
        message,
      });
    }
  };

  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editDepartments, setEditDepartments] = useState('');
  const [editCounties, setEditCounties] = useState('');
  const [editStatus, setEditStatus] = useState<UserAccount['status']>('active');

  const openEditDialog = (user: UserAccount) => {
    setEditUser(user);
    setEditRoles(user.roles);
    setEditDepartments(user.departments.join(', '));
    setEditCounties(user.counties.join(', '));
    setEditStatus(user.status);
  };

  const handleEditSave = async () => {
    if (!editUser) return;
    try {
      const normalizedRoles = Array.from(new Set(editRoles));
      const requestedDepartments = parseList(editDepartments);
      const requestedCounties = parseList(editCounties).map((value) => value.toLowerCase());

      const invalidDepartments = departmentSet.size
        ? requestedDepartments.filter((value) => !departmentSet.has(value.toLowerCase()))
        : [];
      if (invalidDepartments.length) {
        pushToast({
          variant: 'error',
          title: 'Invalid departments',
          message: `Unknown departments: ${invalidDepartments.join(', ')}`,
        });
        return;
      }

      const invalidCounties = countySet.size
        ? requestedCounties.filter((value) => !countySet.has(value))
        : [];
      if (invalidCounties.length) {
        pushToast({
          variant: 'error',
          title: 'Invalid counties',
          message: `Unknown counties: ${invalidCounties.join(', ')}`,
        });
        return;
      }

      const normalizedDepartments = departmentSet.size
        ? requestedDepartments.map((value) => departmentMap.get(value.toLowerCase()) ?? value)
        : requestedDepartments;

      await updateUser.mutateAsync({
        uid: editUser.uid,
        payload: {
          roles: normalizedRoles,
          departments: normalizedDepartments,
          counties: requestedCounties,
          status: editStatus,
        },
      });
      setEditUser(null);
      pushToast({
        variant: 'success',
        title: 'Access updated',
        message: `${editUser.email} roles were updated.`,
      });
    } catch (err) {
      console.error('Failed to update user', err);
      pushToast({
        variant: 'error',
        title: 'Update failed',
        message: 'Could not update user access. Try again.',
      });
    }
  };

  const handleRevoke = async (user: UserAccount) => {
    try {
      await revokeUser.mutateAsync(user.uid);
      pushToast({
        variant: 'success',
        title: 'Sessions revoked',
        message: `All sessions for ${user.email} were revoked.`,
      });
    } catch (err) {
      console.error('Failed to revoke sessions', err);
      pushToast({
        variant: 'error',
        title: 'Revoke failed',
        message: 'Unable to revoke sessions at this time.',
      });
    }
  };

  const handleRequestUpdate = async (request: AccessRequest, status: AccessRequestStatus) => {
    try {
      await updateAccessRequest.mutateAsync({ id: request.id, status });
      pushToast({
        variant: 'success',
        title: 'Request updated',
        message: `${request.email} marked ${status}.`,
      });
    } catch (err) {
      console.error('Failed to update request', err);
      pushToast({
        variant: 'error',
        title: 'Update failed',
        message: 'Unable to update access request. Try again.',
      });
    }
  };

  const manageDisabled = !canManageUsers;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-white border-b border-accent">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg">BailBonds Dashboard</h2>
            </div>
            <div className="flex items-center space-x-4">
              <Bell className="h-5 w-5 text-muted-foreground" />
              {currentUser && (
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <Shield className="h-4 w-4" />
                  <span>{currentUser.email}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {metadataError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Unable to load the latest role and scope metadata. Using fallback defaults until the service responds.
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => onNavigate('profile-settings')}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Profile
            </button>
            <div>
              <h1 className="text-2xl text-foreground flex items-center">
                <Users className="h-6 w-6 mr-3" />
                User Management
              </h1>
              <p className="text-muted-foreground">
                Invite teammates, assign roles, and manage county permissions
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <PillButton
              variant="outline"
              onClick={() => onNavigate('auth-audit')}
            >
              View Audit Log
            </PillButton>
            {manageDisabled ? null : (
              <Dialog
                open={inviteDialogOpen}
                onOpenChange={(open) => {
                  setInviteDialogOpen(open);
                  if (open) {
                    setInviteStep('form');
                    setInviteOutcome(null);
                    setInviteResult(null);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <PillButton>
                    <Plus className="h-4 w-4 mr-2" />
                    Invite User
                  </PillButton>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  {inviteStep === 'form' ? (
                    <>
                      <DialogHeader>
                        <DialogTitle>Invite New User</DialogTitle>
                        <DialogDescription>Send an invitation email and assign initial access.</DialogDescription>
                      </DialogHeader>
                      <form
                        className="space-y-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setInviteStep('confirm');
                        }}
                      >
                        <div className="space-y-2">
                          <Label htmlFor="invite-email">Email address</Label>
                          <Input
                            id="invite-email"
                            type="email"
                            value={inviteForm.email}
                            onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))}
                            placeholder="agent@example.com"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite-name">Display name</Label>
                          <Input
                            id="invite-name"
                            value={inviteForm.displayName}
                            onChange={(event) => setInviteForm((prev) => ({ ...prev, displayName: event.target.value }))}
                            placeholder="Case Manager"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite-role">Role</Label>
                          <Select
                            value={inviteForm.role}
                            onValueChange={(value) => setInviteForm((prev) => ({ ...prev, role: value }))}
                          >
                            <SelectTrigger id="invite-role">
                              <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                              {roleOptions.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {role}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite-departments">Departments (comma-separated)</Label>
                          <Input
                            id="invite-departments"
                            value={inviteForm.departments}
                            onChange={(event) => setInviteForm((prev) => ({ ...prev, departments: event.target.value }))}
                            placeholder="Underwriting, Field Ops"
                          />
                          {metadataLoading ? (
                            <p className="text-xs text-muted-foreground">Loading available departments…</p>
                          ) : departmentOptions.length ? (
                            <p className="text-xs text-muted-foreground">Available departments: {departmentOptions.join(', ')}</p>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite-counties">Counties (comma-separated)</Label>
                          <Input
                            id="invite-counties"
                            value={inviteForm.counties}
                            onChange={(event) => setInviteForm((prev) => ({ ...prev, counties: event.target.value }))}
                            placeholder="harris, brazoria"
                          />
                          <p className="text-xs text-muted-foreground">
                            {metadataLoading ? 'Loading available counties…' : `Available counties: ${countyOptions.join(', ')}`}
                          </p>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                          <PillButton type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                            Cancel
                          </PillButton>
                          <PillButton type="submit">Continue</PillButton>
                        </div>
                      </form>
                    </>
                  ) : inviteStep === 'confirm' ? (
                    <>
                      <DialogHeader>
                        <DialogTitle>Confirm invitation</DialogTitle>
                        <DialogDescription>Review the details before sending.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label>Email</Label>
                          <div className="rounded-md border bg-muted px-3 py-2 text-sm">{inviteForm.email}</div>
                        </div>
                        <div className="space-y-1">
                          <Label>Display name</Label>
                          <div className="rounded-md border bg-muted px-3 py-2 text-sm">{inviteForm.displayName || '—'}</div>
                        </div>
                        <div className="space-y-1">
                          <Label>Role</Label>
                          <div className="rounded-md border bg-muted px-3 py-2 text-sm">{inviteForm.role}</div>
                        </div>
                        <div className="space-y-1">
                          <Label>Departments</Label>
                          <div className="rounded-md border bg-muted px-3 py-2 text-sm">{inviteForm.departments || '—'}</div>
                        </div>
                        <div className="space-y-1">
                          <Label>Counties</Label>
                          <div className="rounded-md border bg-muted px-3 py-2 text-sm">{inviteForm.counties || '—'}</div>
                        </div>
                      </div>
                      <div className="flex justify-between gap-2 pt-4">
                        <PillButton type="button" variant="outline" onClick={() => setInviteStep('form')}>
                          Back
                        </PillButton>
                        <PillButton type="button" onClick={handleInvite} disabled={createUser.isPending}>
                          {createUser.isPending ? 'Sending…' : 'Send Invite'}
                        </PillButton>
                      </div>
                    </>
                  ) : (
                    <>
                      <DialogHeader>
                        <DialogTitle>
                          {inviteOutcome?.ok ? (
                            <span className="inline-flex items-center gap-2 text-emerald-700">
                              <CheckCircle2 className="h-5 w-5" /> Invitation sent
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-rose-700">
                              <XCircle className="h-5 w-5" /> Invite failed
                            </span>
                          )}
                        </DialogTitle>
                        <DialogDescription>
                          {inviteOutcome?.ok ? (
                            inviteOutcome?.emailed ? (
                              <span>
                                We emailed a sign-in link to <span className="font-medium">{inviteOutcome.email}</span>.
                              </span>
                            ) : (
                              <span>
                                Share this one-time link with <span className="font-medium">{inviteOutcome.email}</span> to set a password.
                              </span>
                            )
                          ) : (
                            <span>{inviteOutcome?.error || 'Unable to send invitation.'}</span>
                          )}
                        </DialogDescription>
                      </DialogHeader>
                      {inviteOutcome?.ok && inviteOutcome?.link ? (
                        <Card className="mt-3">
                          <CardContent className="pt-4">
                            <div className="flex items-center gap-2">
                              <Input readOnly value={inviteOutcome.link} className="flex-1" />
                              <PillButton type="button" variant="outline" onClick={() => inviteOutcome.link && navigator.clipboard.writeText(inviteOutcome.link)}>
                                Copy link
                              </PillButton>
                            </div>
                          </CardContent>
                        </Card>
                      ) : null}
                      <div className="flex justify-end gap-2 pt-4">
                        <PillButton
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setInviteOutcome(null);
                            setInviteResult(null);
                            setInviteForm({ email: '', displayName: '', role: inviteForm.role, departments: '', counties: '' });
                            setInviteStep('form');
                          }}
                        >
                          Invite another user
                        </PillButton>
                        <PillButton type="button" onClick={() => setInviteDialogOpen(false)}>
                          Done
                        </PillButton>
                      </div>
                    </>
                  )}
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <Card>
          <CardHeader className="pb-0">
            <CardTitle>Directory</CardTitle>
            <CardDescription>
              {isFetching ? 'Refreshing…' : `Showing ${filteredUsers.length} user${filteredUsers.length === 1 ? '' : 's'}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search by name or email"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
                <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {combinedRoleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {statusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <PillButton variant="outline" onClick={() => refetch()}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Refresh
                </PillButton>
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-lg border border-dashed border-muted p-12 text-center text-sm text-muted-foreground">
                Loading users…
              </div>
            ) : isError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                Failed to load users: {error instanceof Error ? error.message : 'Unknown error'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Counties</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead className="w-[80px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.uid}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{user.displayName || '—'}</span>
                            <span className="text-xs text-muted-foreground">UID: {user.uid}</span>
                          </div>
                        </TableCell>
                        <TableCell>{user.email || '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role) => (
                              <Badge key={role} variant="outline">
                                {role}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {user.counties.length ? (
                            <div className="flex flex-wrap gap-1">
                              {user.counties.map((county) => (
                                <Badge key={county} variant="secondary">
                                  {county}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No counties assigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${statusBadgeTone(user.status)}`}>
                            {statusLabel(user.status)}
                          </span>
                        </TableCell>
                        <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <PillButton variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <Shield className="h-4 w-4" />
                              </PillButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                disabled={manageDisabled}
                                onClick={() => openEditDialog(user)}
                              >
                                <UserCheck className="mr-2 h-4 w-4" />
                                Edit access
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={manageDisabled}
                                onClick={() => handleRevoke(user)}
                              >
                                <UserX className="mr-2 h-4 w-4" />
                                Revoke sessions
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={manageDisabled || user.status === 'suspended' || user.status === 'deleted'}
                                onClick={async () => {
                                  if (!confirm(`Suspend ${user.email}? They won't be able to sign in until reactivated.`)) return;
                                  try {
                                    await updateUser.mutateAsync({ uid: user.uid, payload: { status: 'suspended' } });
                                    pushToast({ variant: 'success', title: 'User suspended', message: `${user.email} cannot sign in.` });
                                  } catch (e) {
                                    pushToast({ variant: 'error', title: 'Suspend failed', message: 'Unable to suspend user.' });
                                  }
                                }}
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Suspend user
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={manageDisabled || user.status !== 'suspended'}
                                onClick={async () => {
                                  try {
                                    await updateUser.mutateAsync({ uid: user.uid, payload: { status: 'active' } });
                                    pushToast({ variant: 'success', title: 'User reactivated', message: `${user.email} can sign in.` });
                                  } catch (e) {
                                    pushToast({ variant: 'error', title: 'Activate failed', message: 'Unable to activate user.' });
                                  }
                                }}
                              >
                                <UserCheck className="mr-2 h-4 w-4" />
                                Activate user
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={manageDisabled || user.status === 'deleted'}
                                onClick={async () => {
                                  if (!confirm(`Archive ${user.email}? They'll be marked deleted but data retained.`)) return;
                                  try {
                                    await updateUser.mutateAsync({ uid: user.uid, payload: { status: 'deleted' } });
                                    pushToast({ variant: 'success', title: 'User archived', message: `${user.email} marked deleted.` });
                                  } catch (e) {
                                    pushToast({ variant: 'error', title: 'Archive failed', message: 'Unable to archive user.' });
                                  }
                                }}
                              >
                                <UserX className="mr-2 h-4 w-4" />
                                Archive user
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  navigator.clipboard.writeText(user.email || '');
                                }}
                              >
                                <Mail className="mr-2 h-4 w-4" />
                                Copy email
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="h-5 w-5" />
                  Access Requests
                </CardTitle>
                <CardDescription>
                  Review invite requests submitted from the login page.
                </CardDescription>
              </div>
              <Select value={requestStatusFilter} onValueChange={(value) => setRequestStatusFilter(value as typeof requestStatusFilter)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
          {accessLoading ? (
              <div className="rounded-lg border border-dashed border-muted p-8 text-center text-sm text-muted-foreground">
                Loading requests…
              </div>
            ) : accessError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                Failed to load access requests: {accessErrorObj instanceof Error ? accessErrorObj.message : 'Unknown error'}
              </div>
            ) : accessRequests.length === 0 ? (
              <div className="rounded-lg border border-muted/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                No requests in this status.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-40 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessRequests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>{request.email}</TableCell>
                        <TableCell>{request.displayName || '—'}</TableCell>
                        <TableCell className="max-w-xs text-sm text-muted-foreground">
                          {request.message || '—'}
                        </TableCell>
                        <TableCell>{formatDate(request.createdAt)}</TableCell>
                        <TableCell>
                          <Badge className="capitalize">{request.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <PillButton
                              size="sm"
                              variant="outline"
                              disabled={updateAccessRequest.isPending}
                              onClick={() => handleRequestUpdate(request, 'completed')}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" />Approve
                            </PillButton>
                            <PillButton
                              size="sm"
                              variant="outline"
                              disabled={updateAccessRequest.isPending}
                              onClick={() => handleRequestUpdate(request, 'rejected')}
                            >
                              <XCircle className="h-4 w-4 mr-2" />Reject
                            </PillButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit user access</DialogTitle>
            <DialogDescription>
              Update roles, departments, and counties for this team member.
            </DialogDescription>
          </DialogHeader>
          {editUser ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <Label>Email</Label>
                <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {editUser.email}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="grid grid-cols-2 gap-2">
                  {combinedRoleOptions.map((role) => {
                    const checked = editRoles.includes(role);
                    return (
                      <label key={role} className="flex items-center space-x-2 rounded-lg border px-2 py-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setEditRoles((prev) => {
                              if (value) {
                                return Array.from(new Set([...prev, role]));
                              }
                              return prev.filter((item) => item !== role);
                            });
                          }}
                        />
                        <span>{role}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Departments (comma-separated)</Label>
                <Input value={editDepartments} onChange={(event) => setEditDepartments(event.target.value)} />
                {metadataLoading ? (
                  <p className="text-xs text-muted-foreground">Loading available departments…</p>
                ) : departmentOptions.length ? (
                  <p className="text-xs text-muted-foreground">
                    Available departments: {departmentOptions.join(', ')}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Counties (comma-separated)</Label>
                <Input value={editCounties} onChange={(event) => setEditCounties(event.target.value)} />
                <p className="text-xs text-muted-foreground">
                  {metadataLoading
                    ? 'Loading available counties…'
                    : `Available counties: ${countyOptions.join(', ')}`}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={(value) => setEditStatus(value as UserAccount['status'])}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {statusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created {formatDate(editUser.createdAt)}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Shield className="h-3.5 w-3.5" />
                  <span>Last role update {formatDate(editUser.lastRoleChangeAt)}</span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <PillButton variant="outline" onClick={() => setEditUser(null)}>
                  Cancel
                </PillButton>
                <PillButton onClick={handleEditSave} disabled={updateUser.isPending}>
                  {updateUser.isPending ? 'Saving…' : 'Save changes'}
                </PillButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <div className="container mx-auto px-4 pb-12">
        <div className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">
          <p className="font-medium mb-2">Access summary</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center space-x-3">
              <Shield className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-wide">SuperUser</p>
                <p className="text-sm text-foreground">Full platform access including user provisioning.</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <UserCheck className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-wide">Admin</p>
                <p className="text-sm text-foreground">Manage users and cases across all counties.</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Mail className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-wide">Invitations</p>
                <p className="text-sm text-foreground">Share invite links securely to complete onboarding.</p>
              </div>
            </div>
          </div>
        </div>
        {currentUser ? (
          <div className="mt-4 flex justify-between text-xs text-muted-foreground">
            <div>
              Signed in as {currentUser.email}
            </div>
            <button
              className="text-primary hover:underline"
              onClick={async () => {
                await signOut();
                onNavigate('landing');
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AdminUserManagement;
