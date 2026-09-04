// =============================================================================
// Pill — a small status / result / priority chip.
//
// `tone` maps to the design-system colour ramps defined in index.css.
// `variant="subtle"` (default) uses the soft background colour; "solid"
// uses the brand-foreground colour (e.g. white text on a coloured chip).
// =============================================================================

import type { ReactNode } from 'react';

export type PillTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  // Result tones — match the legacy result-passed / result-failed / result-not_run
  // CSS classes that the Cypress suite queries against.
  | 'result-passed'
  | 'result-failed'
  | 'result-not-run'
  // Status tones — draft / active / deprecated test cases.
  | 'status-draft'
  | 'status-active'
  | 'status-deprecated'
  // Priority tones.
  | 'priority-high'
  | 'priority-medium'
  | 'priority-low';

type PillProps = {
  tone?: PillTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: ReactNode;
};

export function Pill({ tone = 'neutral', size = 'md', className = '', children }: PillProps) {
  const sizeClass =
    size === 'sm' ? 'rg-pill rg-pill-sm' :
    size === 'lg' ? 'rg-pill rg-pill-lg' :
    'rg-pill';
  return (
    <span className={`${sizeClass} rg-pill-${tone} ${className}`}>{children}</span>
  );
}

// =============================================================================
// Convenience mappers — keep the call site declarative and avoid string drift.
// =============================================================================

const RESULT_TONE: Record<string, PillTone> = {
  passed: 'result-passed',
  failed: 'result-failed',
  not_run: 'result-not-run',
  pending: 'result-not-run',
  running: 'info',
};

export function ResultPill({
  result,
  size = 'md',
}: {
  result: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone = RESULT_TONE[result] ?? 'neutral';
  const label = result.replace(/_/g, ' ');
  return <Pill tone={tone} size={size}>{label}</Pill>;
}

const STATUS_TONE: Record<string, PillTone> = {
  draft: 'status-draft',
  active: 'status-active',
  deprecated: 'status-deprecated',
};

export function StatusPill({
  status,
  size = 'md',
}: {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return <Pill tone={tone} size={size}>{status}</Pill>;
}

const PRIORITY_TONE: Record<string, PillTone> = {
  high: 'priority-high',
  medium: 'priority-medium',
  low: 'priority-low',
};

export function PriorityPill({
  priority,
  size = 'md',
}: {
  priority: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone = PRIORITY_TONE[priority] ?? 'neutral';
  return <Pill tone={tone} size={size}>{priority}</Pill>;
}
