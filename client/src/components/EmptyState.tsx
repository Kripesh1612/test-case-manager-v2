// =============================================================================
// EmptyState — shown when there's no data, no results, no anything.
//
// The icon, title and description read like a tiny product narrative:
// "you're at the start — here's what to do next". Optional CTA on the right.
// =============================================================================

import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// =============================================================================
// Skeleton — pulsing placeholder. Width/height accept Tailwind classes.
// =============================================================================

type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = 'h-4 w-full' }: SkeletonProps) {
  return <div className={`rg-skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
