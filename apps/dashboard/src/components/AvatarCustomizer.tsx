import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { UserAvatar, UserProfile, avatarIcons, avatarColors } from './ui/user-avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { PillButton } from './ui/pill-button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface AvatarCustomizerProps {
  user: UserProfile;
  onSave: (updates: Partial<UserProfile>) => void;
  onCancel: () => void;
}

export function AvatarCustomizer({ user, onSave, onCancel }: AvatarCustomizerProps) {
  const [previewUser, setPreviewUser] = useState<UserProfile>({ ...user });
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setUploadedImage(result);
        setPreviewUser(prev => ({ ...prev, profileImage: result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    const updates: Partial<UserProfile> = {
      initials: previewUser.initials,
      avatarIcon: previewUser.avatarIcon,
      avatarColor: previewUser.avatarColor,
      profileImage: previewUser.profileImage
    };
    onSave(updates);
  };

  const clearImage = () => {
    setUploadedImage(null);
    setPreviewUser(prev => ({ ...prev, profileImage: undefined }));
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Customize Your Avatar</CardTitle>
        <CardDescription>
          Personalize your profile with a custom image, icon, or color
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Preview Section */}
        <div className="text-center space-y-4">
          <div className="flex justify-center space-x-4">
            <div className="text-center">
              <UserAvatar user={previewUser} size="2xl" showStatus status="online" />
              <p className="text-sm text-muted-foreground mt-2">Preview</p>
            </div>
            <div className="text-center">
              <UserAvatar user={previewUser} size="lg" />
              <p className="text-sm text-muted-foreground mt-2">Large</p>
            </div>
            <div className="text-center">
              <UserAvatar user={previewUser} size="md" />
              <p className="text-sm text-muted-foreground mt-2">Medium</p>
            </div>
            <div className="text-center">
              <UserAvatar user={previewUser} size="sm" />
              <p className="text-sm text-muted-foreground mt-2">Small</p>
            </div>
          </div>
        </div>

        {/* Profile Image Upload */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Profile Image</Label>
            {previewUser.profileImage && (
              <button
                onClick={clearImage}
                className="text-sm text-destructive hover:underline flex items-center"
              >
                <X className="h-3 w-3 mr-1" />
                Remove Image
              </button>
            )}
          </div>
          
          <div className="border-2 border-dashed border-muted rounded-lg p-6">
            <div className="text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-2">
                Upload a profile photo (JPG, PNG up to 2MB)
              </p>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="avatar-upload"
              />
              <label htmlFor="avatar-upload">
                <PillButton variant="outline" size="sm" asChild>
                  <span className="cursor-pointer">Choose File</span>
                </PillButton>
              </label>
            </div>
          </div>
        </div>

        {/* Custom Initials */}
        <div className="space-y-2">
          <Label htmlFor="initials">Custom Initials (optional)</Label>
          <Input
            id="initials"
            value={previewUser.initials || ''}
            onChange={(e) => setPreviewUser(prev => ({ 
              ...prev, 
              initials: e.target.value.toUpperCase().slice(0, 2) 
            }))}
            placeholder="Auto-generated from name"
            maxLength={2}
            className="w-24"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to auto-generate from your name
          </p>
        </div>

        {/* Icon Selection */}
        <div className="space-y-4">
          <Label>Avatar Icon (when no image)</Label>
          <div className="grid grid-cols-6 gap-3">
            {Object.entries(avatarIcons).map(([key, IconComponent]) => (
              <button
                key={key}
                onClick={() => setPreviewUser(prev => ({ 
                  ...prev, 
                  avatarIcon: key as keyof typeof avatarIcons 
                }))}
                className={`p-3 rounded-lg border-2 transition-colors ${
                  previewUser.avatarIcon === key 
                    ? 'border-primary bg-primary/5' 
                    : 'border-muted hover:border-primary/50'
                }`}
              >
                <IconComponent className="h-5 w-5 mx-auto" />
              </button>
            ))}
          </div>
        </div>

        {/* Color Selection */}
        <div className="space-y-4">
          <Label>Avatar Color</Label>
          <div className="grid grid-cols-7 gap-3">
            {Object.entries(avatarColors).map(([key, colorClass]) => (
              <button
                key={key}
                onClick={() => setPreviewUser(prev => ({ 
                  ...prev, 
                  avatarColor: key as keyof typeof avatarColors 
                }))}
                className={`h-10 w-10 rounded-lg border-2 transition-all ${colorClass} ${
                  previewUser.avatarColor === key 
                    ? 'border-slate-800 scale-110' 
                    : 'border-slate-300 hover:scale-105'
                }`}
                title={key}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-muted">
          <PillButton variant="outline" onClick={onCancel}>
            Cancel
          </PillButton>
          <PillButton onClick={handleSave}>
            Save Changes
          </PillButton>
        </div>
      </CardContent>
    </Card>
  );
}