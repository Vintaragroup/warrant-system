import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { useToast } from '../components/ToastContext';
import {
  useCheckins,
  useCheckInOptions,
  useLogCheckinContact,
  useCheckInDetail,
  useCheckInTimeline,
  useTriggerCheckInPing,
  useCreateCheckIn,
  useRecordCheckInAttendance,
} from '../hooks/checkins';
import CheckInSummary from '../components/checkins/CheckInSummary';
import CheckInFilters from '../components/checkins/CheckInFilters';
import CheckInList from '../components/checkins/CheckInList';
import CheckInDetailDrawer from '../components/checkins/CheckInDetailDrawer';
import CheckInFormModal from '../components/checkins/CheckInFormModal';

function mapToListItems(items = []) {
  return items.map((item) => ({
    id: item.id,
    clientName: item.clientName || item.person || 'Unknown',
    caseNumber: item.caseNumber || null,
    county: item.county || null,
    dueAt: item.dueAt || null,
    status: item.status || 'pending',
    contactCount: item.contactCount || 0,
    lastContactAt: item.lastContactAt || null,
    method: item.method || null,
    note: item.note || null,
    location: item.location || null,
    gpsEnabled: Boolean(item.gpsEnabled),
    attendance: item.attendance || null,
  }));
}

export default function CheckIns() {
  const [filters, setFilters] = useState({ scope: 'today', officer: 'all', search: '' });
  const [selectedCheckInId, setSelectedCheckInId] = useState(null);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isFormOpen, setFormOpen] = useState(false);

  const { pushToast } = useToast();

  const optionsQuery = useCheckInOptions();
  const clientOptions = useMemo(() => optionsQuery.data?.clients ?? [], [optionsQuery.data]);
  const officerOptions = useMemo(() => optionsQuery.data?.officers ?? [], [optionsQuery.data]);

  const clientLookup = useMemo(() => {
    const map = new Map();
    clientOptions.forEach((option) => {
      if (option?.id) map.set(option.id, option);
    });
    return map;
  }, [clientOptions]);

  const queryFilters = useMemo(() => {
    const params = { scope: filters.scope };
    if (filters.officer && filters.officer !== 'all') params.officer = filters.officer;
    if (filters.search) params.search = filters.search;
    return params;
  }, [filters]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useCheckins(queryFilters);

  const logContact = useLogCheckinContact({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Contact logged', message: 'Contact recorded successfully.' });
      refetch();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Log failed', message: err?.message || 'Unable to log contact.' });
    },
  });

  const triggerPing = useTriggerCheckInPing({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Ping queued', message: 'Manual ping request queued.' });
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Ping failed', message: err?.message || 'Unable to trigger ping.' });
    },
  });

  const recordAttendance = useRecordCheckInAttendance({
    onSuccess: (_data, variables) => {
      pushToast({ variant: 'success', title: 'Attendance recorded', message: 'Marked as completed.' });
      refetch();
      if (variables?.id && variables.id === selectedCheckInId) {
        detailQuery.refetch();
        timelineQuery.refetch();
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Attendance failed', message: err?.message || 'Unable to record attendance.' });
    },
  });

  const createCheckIn = useCreateCheckIn({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Check-in scheduled', message: 'New check-in created.' });
      setFormOpen(false);
      refetch();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Create failed', message: err?.message || 'Unable to schedule check-in.' });
    },
  });

  const summary = useMemo(() => {
    const stats = data?.stats || {};
    return {
      upcoming: stats.totalToday ?? 0,
      overdue: stats.overdue ?? 0,
      completed: stats.completed ?? 0,
      gpsEnabled: stats.gpsEnabled ?? 0,
    };
  }, [data]);

  const listItems = useMemo(() => mapToListItems(data?.items), [data]);
  const detailQuery = useCheckInDetail(selectedCheckInId, {
    enabled: isDrawerOpen && Boolean(selectedCheckInId),
  });
  const timelineQuery = useCheckInTimeline(selectedCheckInId, {
    enabled: isDrawerOpen && Boolean(selectedCheckInId),
  });

  const activeCheckIn = detailQuery.data?.checkIn
    ? {
        ...detailQuery.data.checkIn,
        clientName: detailQuery.data.checkIn.clientName || detailQuery.data.checkIn.person || 'Unknown',
        caseNumber: detailQuery.data.checkIn.caseNumber || null,
        timeline: timelineQuery.data?.timeline || [],
        gpsEnabled: detailQuery.data.checkIn.gpsEnabled,
        lastPingAt: detailQuery.data.checkIn.lastPingAt,
        note: detailQuery.data.checkIn.note,
        attendance: detailQuery.data.checkIn.attendance || null,
      }
    : null;

  const handleScopeChange = (scope) => {
    setFilters((prev) => ({ ...prev, scope }));
  };

  const handleMarkDone = (id) => {
    recordAttendance.mutate({ id, status: 'attended' });
  };

  const handleLogContact = (id) => {
    logContact.mutate({ id, increment: 1 });
  };

  const handleOpenDetail = (id) => {
    setSelectedCheckInId(id);
    setDrawerOpen(true);
  };

  const handleCreateCheckIn = async () => {
    if (!clientOptions.length && !optionsQuery.isLoading) {
      pushToast({
        variant: 'warning',
        title: 'No clients available',
        message: 'Add a case or refresh options before scheduling a check-in.',
      });
      return;
    }
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Check-ins</h1>
          <p className="text-sm text-slate-600">Monitor daily assignments, GPS pings, and follow-up tasks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline">Send batch reminder</Button>
          <Button onClick={handleCreateCheckIn}>Schedule check-in</Button>
        </div>
      </div>

      <CheckInSummary stats={summary} isLoading={isLoading} />

      <CheckInFilters
        scope={filters.scope}
        onScopeChange={handleScopeChange}
        officer={filters.officer}
        onOfficerChange={(value) => setFilters((prev) => ({ ...prev, officer: value }))}
        search={filters.search}
        onSearchChange={(value) => setFilters((prev) => ({ ...prev, search: value }))}
        officers={officerOptions}
        onOpenReminderSettings={() => pushToast({ variant: 'info', title: 'Coming soon', message: 'Reminder settings will be available after provider setup.' })}
      />

      {isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load check-ins: {error?.message || 'Unknown error'}
        </div>
      ) : (
        <CheckInList
          isLoading={isLoading}
          items={listItems}
          onMarkDone={handleMarkDone}
          onLogContact={handleLogContact}
          onOpenDetail={handleOpenDetail}
          isMarking={recordAttendance.isPending}
        />
      )}

      <CheckInDetailDrawer
        open={isDrawerOpen}
        onOpenChange={setDrawerOpen}
        checkIn={activeCheckIn}
        onTriggerPing={(id) => triggerPing.mutate(id)}
      />

      <CheckInFormModal
        open={isFormOpen}
        onOpenChange={setFormOpen}
        onSubmit={async (values) => {
          const selectedClient = clientLookup.get(values.clientId);
          if (!selectedClient) {
            pushToast({
              variant: 'error',
              title: 'Client required',
              message: 'Select a client before scheduling a check-in.',
            });
            return;
          }
          await createCheckIn.mutateAsync({
            clientId: selectedClient.id,
            caseId: selectedClient.id,
            person: selectedClient.name,
            personName: selectedClient.name,
            caseNumber: selectedClient.caseNumber,
            county: selectedClient.county,
            officerId: values.officerId || undefined,
            dueAt: values.scheduleAt,
            timezone: values.timezone,
            method: values.method,
            notes: values.notes,
            remindersEnabled: values.remindersEnabled,
            gpsEnabled: values.gpsEnabled,
            pingsPerDay: values.pingsPerDay,
            locationText: values.location,
          });
        }}
        clients={clientOptions}
        officers={officerOptions}
        isSubmitting={createCheckIn.isPending}
      />
    </div>
  );
}
