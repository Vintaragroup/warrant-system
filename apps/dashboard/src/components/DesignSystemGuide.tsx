import React from 'react';
import { ArrowLeft, Palette, Type, Layout, Smartphone } from 'lucide-react';
import { PillButton } from './ui/pill-button';
import { StatusChip } from './ui/status-chip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { AuthScreen } from './auth/types';

interface DesignSystemGuideProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function DesignSystemGuide({ onNavigate }: DesignSystemGuideProps) {
  const colors = [
    { name: 'Primary Blue', value: '#1d4ed8', usage: 'CTAs, links, focus states' },
    { name: 'Primary Blue Hover', value: '#2563eb', usage: 'Hover states for primary elements' },
    { name: 'Slate 900', value: '#0f172a', usage: 'Primary text, headings' },
    { name: 'Slate 700', value: '#334155', usage: 'Secondary text' },
    { name: 'Slate 500', value: '#64748b', usage: 'Muted text, labels' },
    { name: 'Slate 200', value: '#e2e8f0', usage: 'Borders, dividers' },
    { name: 'Slate 100', value: '#f1f5f9', usage: 'Secondary backgrounds' },
    { name: 'Slate 50', value: '#f8fafc', usage: 'Muted backgrounds' },
    { name: 'Success Green', value: '#10b981', usage: 'Success states, confirmations' },
    { name: 'Error Rose', value: '#f43f5e', usage: 'Error states, destructive actions' },
    { name: 'Background', value: '#fefefe', usage: 'Main background' },
    { name: 'Card White', value: '#ffffff', usage: 'Card backgrounds' },
  ];

  const spacingValues = [
    { value: '4px', usage: '0.5', description: 'Micro spacing' },
    { value: '8px', usage: '1', description: 'Base unit - internal component padding' },
    { value: '12px', usage: '1.5', description: 'Small gaps between related elements' },
    { value: '16px', usage: '2', description: 'Standard component spacing' },
    { value: '24px', usage: '3', description: 'Section spacing' },
    { value: '32px', usage: '4', description: 'Large section gaps' },
    { value: '48px', usage: '6', description: 'Page section separation' },
    { value: '64px', usage: '8', description: 'Major layout spacing' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => onNavigate('landing')}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Demo
            </button>
            <div>
              <h1 className="text-2xl text-foreground flex items-center">
                <Layout className="h-6 w-6 mr-3" />
                Design System Guide
              </h1>
              <p className="text-muted-foreground">
                BailBonds Dashboard design tokens and component library
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Colors */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Palette className="h-5 w-5 mr-2" />
                Color Palette
              </CardTitle>
              <CardDescription>
                Primary colors following clean, data-forward design principles
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {colors.map((color) => (
                <div key={color.name} className="flex items-center space-x-4">
                  <div 
                    className="w-12 h-12 rounded-lg border border-slate-200 flex-shrink-0"
                    style={{ backgroundColor: color.value }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{color.name}</span>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {color.value}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{color.usage}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Typography */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Type className="h-5 w-5 mr-2" />
                Typography Scale
              </CardTitle>
              <CardDescription>
                Inter font family with consistent sizing and weights
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h1 className="mb-2">Heading 1 - 24px Medium</h1>
                <p className="text-xs text-muted-foreground">Main page titles, primary headings</p>
              </div>
              <div>
                <h2 className="mb-2">Heading 2 - 20px Medium</h2>
                <p className="text-xs text-muted-foreground">Section headings, card titles</p>
              </div>
              <div>
                <h3 className="mb-2">Heading 3 - 18px Medium</h3>
                <p className="text-xs text-muted-foreground">Subsection headings</p>
              </div>
              <div>
                <h4 className="mb-2">Heading 4 - 16px Medium</h4>
                <p className="text-xs text-muted-foreground">Small headings, labels</p>
              </div>
              <div>
                <p className="mb-2">Body Text - 16px Regular</p>
                <p className="text-xs text-muted-foreground">Primary body content, descriptions</p>
              </div>
              <div>
                <p className="text-sm mb-2">Small Text - 14px Regular</p>
                <p className="text-xs text-muted-foreground">Secondary information, captions</p>
              </div>
              <div>
                <p className="text-xs mb-2">Caption - 12px Regular</p>
                <p className="text-xs text-muted-foreground">Fine print, metadata</p>
              </div>
            </CardContent>
          </Card>

          {/* Spacing Grid */}
          <Card>
            <CardHeader>
              <CardTitle>8pt Grid System</CardTitle>
              <CardDescription>
                Consistent spacing based on 8px increments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {spacingValues.map((spacing) => (
                <div key={spacing.value} className="flex items-center space-x-4">
                  <div 
                    className="bg-primary rounded"
                    style={{ width: spacing.value, height: '16px', minWidth: spacing.value }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{spacing.value}</span>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        space-{spacing.usage}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{spacing.description}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Components */}
          <Card>
            <CardHeader>
              <CardTitle>Component Library</CardTitle>
              <CardDescription>
                Reusable UI components with consistent styling
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Buttons */}
              <div>
                <h4 className="mb-3">Pill Buttons</h4>
                <div className="flex flex-wrap gap-2">
                  <PillButton>Primary</PillButton>
                  <PillButton variant="secondary">Secondary</PillButton>
                  <PillButton variant="outline">Outline</PillButton>
                  <PillButton variant="ghost">Ghost</PillButton>
                </div>
              </div>

              {/* Status Chips */}
              <div>
                <h4 className="mb-3">Status Chips</h4>
                <div className="flex flex-wrap gap-2">
                  <StatusChip status="success">Active</StatusChip>
                  <StatusChip status="pending">Pending</StatusChip>
                  <StatusChip status="error">Error</StatusChip>
                  <StatusChip status="inactive">Inactive</StatusChip>
                </div>
              </div>

              {/* Badges */}
              <div>
                <h4 className="mb-3">Badges</h4>
                <div className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <Badge variant="destructive">Destructive</Badge>
                </div>
              </div>

              {/* Form Elements */}
              <div>
                <h4 className="mb-3">Form Elements</h4>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="sample-input">Sample Input</Label>
                    <Input id="sample-input" placeholder="Enter text here..." />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cards & Layout */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Smartphone className="h-5 w-5 mr-2" />
                Layout Principles
              </CardTitle>
              <CardDescription>
                Guidelines for responsive, accessible design
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="mb-3">Cards & Containers</h4>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• 12px border radius for modern, friendly feel</li>
                    <li>• Subtle shadows (shadow-lg) for depth</li>
                    <li>• White backgrounds on soft background (#fefefe)</li>
                    <li>• 24px padding for content areas</li>
                    <li>• Clear visual hierarchy with consistent spacing</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3">Responsive Behavior</h4>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Mobile-first responsive design</li>
                    <li>• Grid layouts adapt from 1→2→3 columns</li>
                    <li>• Touch-friendly 44px minimum tap targets</li>
                    <li>• Readable text sizes across all devices</li>
                    <li>• Accessible color contrast ratios (WCAG AA)</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3">Data Tables</h4>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Medium density with comfortable row height</li>
                    <li>• Zebra striping for better readability</li>
                    <li>• Sticky headers for long datasets</li>
                    <li>• Status indicators with color coding</li>
                    <li>• Sortable columns with clear affordances</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3">Iconography</h4>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Lucide React icons for consistency</li>
                    <li>• 16px (h-4 w-4) for inline, 20px (h-5 w-5) for buttons</li>
                    <li>• Contextual icons that reinforce meaning</li>
                    <li>• Proper icon-text alignment and spacing</li>
                    <li>• Semantic usage (shield=security, users=people)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Implementation Notes */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Implementation Notes</CardTitle>
            <CardDescription>
              Technical guidelines for developers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="mb-3">Component Architecture</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Reusable components in /components directory</li>
                  <li>• TypeScript interfaces for all props</li>
                  <li>• Consistent naming conventions (PascalCase)</li>
                  <li>• Shadcn/ui base components in /components/ui</li>
                  <li>• Custom components extend base functionality</li>
                </ul>
              </div>
              <div>
                <h4 className="mb-3">Styling Guidelines</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Tailwind CSS v4.0 with CSS variables</li>
                  <li>• No custom font sizes, weights, or line-heights</li>
                  <li>• Use design tokens from theme configuration</li>
                  <li>• Consistent class ordering (layout → spacing → colors)</li>
                  <li>• Responsive classes for mobile-first approach</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
