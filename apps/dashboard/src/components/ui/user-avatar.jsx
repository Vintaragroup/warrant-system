/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { User, Shield, Star, Crown, Briefcase, UserCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { cn } from './utils';

// Available avatar icons
export const avatarIcons = {
  user: User,
  shield: Shield,
  star: Star,
  crown: Crown,
  briefcase: Briefcase,
  userCheck: UserCheck,
};

// Available avatar colors
export const avatarColors = {
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500', 
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  yellow: 'bg-yellow-500',
  lime: 'bg-lime-500',
  green: 'bg-green-500',
  emerald: 'bg-emerald-500',
  teal: 'bg-teal-500',
  cyan: 'bg-cyan-500',
  slate: 'bg-slate-500',
};

const sizeClasses = {
  xs: 'h-6 w-6 text-xs',
  sm: 'h-8 w-8 text-xs', 
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
  '2xl': 'h-20 w-20 text-xl'
};

const iconSizes = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5', 
  lg: 'h-6 w-6',
  xl: 'h-8 w-8',
  '2xl': 'h-10 w-10'
};

const statusSizes = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3', 
  xl: 'h-4 w-4',
  '2xl': 'h-5 w-5'
};

const statusColors = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  away: 'bg-yellow-500', 
  busy: 'bg-red-500'
};

export function UserAvatar({ 
  user, 
  size = 'md', 
  showStatus = false,
  status = 'online',
  className,
  onClick 
}) {
  const initials = user.initials || user.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const IconComponent = user.avatarIcon ? avatarIcons[user.avatarIcon] : null;
  const colorClass = user.avatarColor ? avatarColors[user.avatarColor] : 'bg-primary';

  return (
    <div className={cn('relative inline-block', className)}>
      <Avatar 
        className={cn(
          sizeClasses[size], 
          onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
          !user.profileImage && colorClass
        )}
        onClick={onClick}
      >
        <AvatarImage src={user.profileImage} alt={user.name} />
        <AvatarFallback className={cn('text-white', colorClass)}>
          {IconComponent ? (
            <IconComponent className={cn('text-white', iconSizes[size])} />
          ) : (
            initials
          )}
        </AvatarFallback>
      </Avatar>
      
      {showStatus && (
        <div 
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-white',
            statusSizes[size],
            statusColors[status]
          )}
        />
      )}
    </div>
  );
}

// User avatar with dropdown menu
export function UserAvatarMenu({
  user,
  size = 'md',
  showStatus = false,
  status = 'online',
  className,
  onProfileClick,
  onSettingsClick, 
  onSignOutClick
}) {
  return (
    <div className="relative group">
      <UserAvatar
        user={user}
        size={size}
        showStatus={showStatus}
        status={status}
        className={className}
      />
      
      {/* Dropdown menu - would typically use a proper dropdown component */}
      <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-accent opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
        <div className="p-3 border-b border-accent">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
          <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
        </div>
        <div className="py-1">
          {onProfileClick && (
            <button 
              onClick={onProfileClick}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
            >
              View Profile
            </button>
          )}
          {onSettingsClick && (
            <button
              onClick={onSettingsClick} 
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
            >
              Settings
            </button>
          )}
          {onSignOutClick && (
            <>
              <div className="border-t border-accent my-1" />
              <button
                onClick={onSignOutClick}
                className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/5 transition-colors"
              >
                Sign Out
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}