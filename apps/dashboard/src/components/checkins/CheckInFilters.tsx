import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

export interface CheckInFiltersProps {
  scope: string;
  onScopeChange: (value: string) => void;
  officer?: string;
  onOfficerChange?: (value: string) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  scopes?: Array<{ id: string; label: string }>;
  officers?: Array<{ id: string; name: string }>;
  onOpenReminderSettings?: () => void;
}

const DEFAULT_SCOPES = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' },
];

export function CheckInFilters({
  scope,
  onScopeChange,
  officer,
  onOfficerChange,
  search,
  onSearchChange,
  scopes = DEFAULT_SCOPES,
  officers = [],
  onOpenReminderSettings,
}: CheckInFiltersProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <Tabs value={scope} onValueChange={onScopeChange} className="w-full lg:w-auto">
        <TabsList className="flex w-full justify-start overflow-x-auto">
          {scopes.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="whitespace-nowrap">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {onOfficerChange ? (
          <Select value={officer || 'all'} onValueChange={onOfficerChange}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All officers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All officers</SelectItem>
              {officers.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {onSearchChange ? (
          <Input
            className="w-full sm:w-60"
            placeholder="Search client or case"
            value={search || ''}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        ) : null}

        {onOpenReminderSettings ? (
          <Button variant="outline" onClick={onOpenReminderSettings}>
            Reminder settings
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default CheckInFilters;
