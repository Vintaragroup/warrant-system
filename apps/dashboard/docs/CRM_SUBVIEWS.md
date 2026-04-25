# CRM Sub-Views Architecture

**Date:** October 22, 2025  
**Status:** Stable & Production-Ready

## Overview

The CRM tab now features a unified workflow with **sub-views** that consolidate all case management operations into a single, organized interface. This replaces the previous top-level tab structure for Check-ins, Checklist, Documents, and Communications, improving navigation and workflow efficiency.

## Sub-View Components

The CRM tab includes the following sub-views:

| Sub-View           | ID               | Purpose                                                     | Keyboard Shortcut |
| ------------------ | ---------------- | ----------------------------------------------------------- | ----------------- |
| **Summary**        | `summary`        | Stage tracking, ownership, contact info, decisions, history | Alt+S             |
| **Check-ins**      | `checkins`       | GPS-enabled device check-ins, ping status, contact logs     | Alt+K             |
| **Checklist**      | `checklist`      | Onboarding tasks, required documents, progress tracking     | Alt+L             |
| **Documents**      | `documents`      | Case document uploads, attachments, audit trail             | Alt+D             |
| **Communications** | `communications` | Messages, outreach history, communication preferences       | Alt+M             |

## Navigation

### Quick Actions Bar

At the top of the CRM view, the **Quick Actions** section provides:

- **Operational buttons** (left): Ping Now, Message Client, Refresh
- **Sub-view pills** (right): Five navigation buttons (Summary, Check-ins, Checklist, Documents, Comms)
- **Keyboard shortcut legend** (bottom): Reference for all keyboard shortcuts

### Sticky headers (Oct 23, 2025)

- The CRM Quick Actions bar and sub-view pills are now sticky within the CRM tab, staying visible while you scroll longer lists (e.g., Documents, Comms).
- The top-level case tabs (Overview/CRM/Enrichment/Activity) are also sticky under the page header to keep high-level navigation at hand.
- Implementation is purely presentational (CSS position: sticky) and does not change data or routing behavior.

### URL Synchronization

Sub-view navigation is fully synchronized with the URL query parameter `?crmView=`:

- `/case/:id?tab=crm` → Summary (default)
- `/case/:id?tab=crm&crmView=checkins` → Check-ins
- `/case/:id?tab=crm&crmView=checklist` → Checklist
- `/case/:id?tab=crm&crmView=documents` → Documents
- `/case/:id?tab=crm&crmView=communications` → Communications

**Deep-linking:** Copy the URL and share it; users will load directly into the requested sub-view.

## Keyboard Shortcuts

When the CRM tab is active, use the following keyboard shortcuts for quick navigation:

| Shortcut  | Sub-View                         |
| --------- | -------------------------------- |
| **Alt+S** | Summary                          |
| **Alt+K** | Check-ins (K for "**K**heckins") |
| **Alt+L** | Chec**K**list                    |
| **Alt+D** | Documents                        |
| **Alt+M** | Co**M**munications               |

**Note:** These shortcuts are available on macOS (Cmd+Key) and Windows/Linux (Alt+Key).

## Visual Indicators

### Breadcrumb in Page Header

When viewing a CRM sub-view, the page header subtitle displays a breadcrumb:

- CRM → Summary (default)
- CRM → Check-ins (when on Check-ins sub-view)
- CRM → Checklist (when on Checklist sub-view)
- CRM → Documents (when on Documents sub-view)
- CRM → Communications (when on Communications sub-view)

### Active Sub-View Highlighting

The active sub-view pill is highlighted in the Quick Actions bar:

- **Active:** Blue background and blue text (`bg-blue-50 text-blue-700 border-blue-300`)
- **Inactive:** Gray background and gray text (default slate colors)

## Smooth Transitions

When switching between sub-views, content fades in smoothly over 300ms using CSS animations. This provides visual feedback and improves perceived responsiveness.

## User Preferences

### Persistence

The last active sub-view for each case is automatically saved to **localStorage** (per caseId):

- Key format: `crm-panel-preference-{caseId}`
- When reopening a case, the dashboard restores the last active sub-view
- **URL parameters take precedence** over saved preferences (for deep-linking)

### Privacy & Storage

- Preferences are stored **locally** in the browser's localStorage
- No data is sent to the backend for preference storage
- Preferences are **case-specific** and isolated by caseId
- Clearing browser storage will reset preferences

## Analytics & Monitoring

### Logging

CRM sub-view access is logged to the browser console with the following metadata:

```javascript
{
  caseId: "...",
  subView: "checklist",  // or "summary", "checkins", "documents", "communications"
  timestamp: "2025-10-22T14:30:45.123Z",
  userAgent: "Mozilla/5.0..."
}
```

### Backend Integration (Future)

The logging infrastructure is prepared for backend analytics integration:

- POST endpoint: `/api/analytics/crm-view-access` (optional)
- Payload includes caseId, subView ID, timestamp, and user context
- Disabled by default; enable by uncommenting the analytics service call in `CaseDetail.jsx`

## Technical Implementation

### State Management

- **activeTab:** Top-level tab selector (`'crm'`, `'enrichment'`, etc.)
- **crmPanel:** CRM sub-view selector (`'summary'`, `'checkins'`, `'checklist'`, `'documents'`, `'communications'`)
- **searchParams:** URL query parameters (used for deep-linking)

### Key Functions

- `goCrmPanel(panel)` — Navigate to a sub-view, update state, and sync URL
- `CRM_VIEWS` — Constant array defining all available sub-views with labels and shortcuts

### Keyboard Shortcut Handler

Effect in `CaseDetail.jsx` (starting ~line 870) listens for Alt+Key combinations and triggers navigation:

```javascript
const handleKeyDown = (e) => {
  if (!e.altKey && !e.metaKey) return;
  const keyMap = {
    s: "summary",
    k: "checkins",
    l: "checklist",
    d: "documents",
    m: "communications",
  };
  const target = keyMap[e.key?.toLowerCase()];
  if (target) {
    e.preventDefault();
    goCrmPanel(target);
  }
};
```

## Migration from Top-Level Tabs

Previously, Check-ins, Checklist, Documents, and Communications were top-level tabs in the main navigation. With the sub-views architecture:

- **Old tab URLs** are automatically redirected to CRM sub-views
- **Existing shortcuts/bookmarks** continue to work via URL redirects
- **All functionality** remains unchanged; only the navigation structure has improved

### Redirect Logic

If a user navigates to a deprecated top-level tab (e.g., `?tab=checklist`), the dashboard automatically redirects to the CRM sub-view:

- `?tab=checkins` → `?tab=crm&crmView=checkins`
- `?tab=checklist` → `?tab=crm&crmView=checklist`
- `?tab=documents` → `?tab=crm&crmView=documents`
- `?tab=communications` → `?tab=crm&crmView=communications`

## Future Enhancements

Potential improvements to explore:

1. **Sub-navigation anchors** — Scroll within a sub-view to specific sections
2. **Animated transitions** — Add slide/scale effects in addition to fade-in
3. **Tab memory** — Remember last sub-view per case across multiple sessions
4. **Search integration** — Quick-search across sub-view content (checklist items, messages, etc.)
5. **Custom layouts** — Allow users to arrange or hide sub-views based on preferences
6. **Advanced analytics** — Track usage patterns, most-used sub-views, time-in-view, etc.

## Testing Checklist

- [ ] Navigation pills highlight correctly when active
- [ ] URL updates when switching sub-views
- [ ] Deep-links load the correct sub-view
- [ ] Keyboard shortcuts work (Alt+S, Alt+K, etc.)
- [ ] Page header breadcrumb updates dynamically
- [ ] Content fades smoothly when switching views
- [ ] Sub-view preference persists when reopening the case
- [ ] Analytics logs appear in browser console
- [ ] Old tab URLs still redirect correctly
- [ ] All sub-view content renders correctly (no layout shifts)

## Files Modified

- `src/pages/CaseDetail.jsx` — Main component with sub-view logic and keyboard shortcuts
- `tailwind.config.js` — Added `fadeIn` animation keyframes

## Related Documentation

- [Dashboard README](../README.md) — General dashboard overview
- [WINDOWS_V2_STATUS.md](./WINDOWS_V2_STATUS.md) — Feature status tracking
- [Case UI Refinement Plan](../../Inmate_enrichment/docs/Case_UI_Refinement_Plan.md) — Historical context
