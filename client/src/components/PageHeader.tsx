// =============================================================================
// PageHeader — title block that sits at the top of every page.
//
// Variants:
//   - default → title + optional description, with action area on the right
//   - hero    → larger, with optional eyebrow / kicker, used on the dashboard
// =============================================================================

import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: 'default' | 'hero';
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  variant = 'default',
}: PageHeaderProps) {
  if (variant === 'hero') {
    return (
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          {eyebrow && (
            <div className="text-xs font-semibold uppercase tracking-wider text-brand mb-2">
              {eyebrow}
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-base text-text-secondary max-w-2xl">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        {eyebrow && (
          <div className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-1">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
