// =============================================================================
// Card — a generic surface for grouping content.
//
// `tone` controls emphasis:
//   - "default"   → white surface, subtle border + shadow (most uses)
//   - "feature"   → subtle gradient + larger radius (used on dashboards)
//   - "hero"      → brand-coloured card with overlay gradient
//   - "flush"     → no padding; caller controls inner spacing
// =============================================================================

import type { HTMLAttributes, ReactNode } from 'react';

type Tone = 'default' | 'feature' | 'hero' | 'flush';

type CardProps = {
  tone?: Tone;
  hover?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export function Card({
  tone = 'default',
  hover = false,
  className = '',
  children,
  ...rest
}: CardProps) {
  const toneClass =
    tone === 'feature' ? 'rg-card-feature' :
    tone === 'hero' ? 'rg-card-hero' :
    tone === 'flush' ? '' :
    'rg-card';
  const hoverClass = hover ? 'rg-card-hover' : '';
  return (
    <div className={`${toneClass} ${hoverClass} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

// Convenience: section header used inside cards.
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {description && (
          <p className="text-xs text-text-secondary mt-0.5">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
