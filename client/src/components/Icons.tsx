// =============================================================================
// Icon set — single source of truth for line icons used in the app.
//
// All icons inherit currentColor so they take on the surrounding text colour.
// Stroke width is held at 1.75 so the visual weight is consistent across the
// set. Sizes are 18px by default to match body copy line-height.
// =============================================================================

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (props: IconProps) => ({
  width: props.size ?? 18,
  height: props.size ?? 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const Icon = {
  Dashboard: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Cases: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M4 7h11l2 2h3v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  ),
  Suites: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M4 6h6l2 2h8v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
    </svg>
  ),
  Schedule: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Admin: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  Trash: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </svg>
  ),
  Plus: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Search: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  Run: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M7 5l12 7-12 7V5z" fill="currentColor" stroke="none" />
    </svg>
  ),
  History: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Diff: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M8 4l-4 8 4 8M16 4l4 8-4 8" />
    </svg>
  ),
  Flaky: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
    </svg>
  ),
  Versions: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <circle cx="7" cy="6" r="2.5" />
      <circle cx="17" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M9 8l2 8M15 8l-2 8" />
    </svg>
  ),
  Check: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  X: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  Logout: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
  Edit: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Settings: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  Filter: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M3 5h18l-7 9v6l-4-2v-4L3 5z" />
    </svg>
  ),
  TrendUp: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  ),
  TrendDown: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M3 7l6 6 4-4 8 8" />
      <path d="M14 17h7v-7" />
    </svg>
  ),
  Spark: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  ),
  GitCompare: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <circle cx="5" cy="6" r="2.5" />
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="19" cy="18" r="2.5" />
      <path d="M5 8.5v7" />
      <path d="M19 15.5V8.5a3 3 0 0 0-3-3h-3" />
    </svg>
  ),
  Mail: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  ),
  Lock: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  ),
  Chevron: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  ArrowRight: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
  Copy: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  Pause: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  Warning: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  ),
  Restore: (p: IconProps) => (
    <svg {...base(p)} {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
};
