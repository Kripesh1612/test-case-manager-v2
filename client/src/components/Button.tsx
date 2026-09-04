// =============================================================================
// Button — primary CTA + secondary/ghost/danger variants.
//
// Wraps a native <button> so it remains focusable, form-associatable and
// works with the Enter/Space keyboard contract. Use `as="link"` (a regular
// anchor styled like a button) for navigation actions that should still
// look like a button.
// =============================================================================

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'rg-btn rg-btn-primary',
  brand: 'rg-btn rg-btn-brand',
  secondary: 'rg-btn rg-btn-secondary',
  ghost: 'rg-btn rg-btn-ghost',
  danger: 'rg-btn rg-btn-danger',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'rg-btn-sm',
  md: '',
  lg: 'rg-btn-lg',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="rg-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12" cy="12" r="9"
        stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor" strokeWidth="3" strokeLinecap="round"
      />
    </svg>
  );
}
