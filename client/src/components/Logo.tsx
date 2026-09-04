// =============================================================================
// Regress brand mark.
//
// The wordmark is "Regress" in display weight. The mark is two stacked
// chevrons tilted down-and-right — a stylised "regress" arrow that doubles
// as a sideways graph going the wrong way. Reads as "things trending down"
// which matches the product promise (catch the regression before users do).
//
// `variant` controls context:
//   - "full"      → wordmark + icon for headers, login screens
//   - "wordmark"  → text only, for tight spaces
//   - "icon"      → mark only, used in favicons, mobile nav, OG images
//   - "inverse"   → white-tinted for use on coloured hero cards
// =============================================================================

type LogoProps = {
  variant?: 'full' | 'wordmark' | 'icon' | 'inverse';
  size?: number;
  className?: string;
};

export function Logo({ variant = 'full', size = 28, className = '' }: LogoProps) {
  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Soft halo behind the chevrons — visible against any background. */}
      <rect width="32" height="32" rx="8" fill="url(#regress-bg)" />
      {/* Two stacked chevrons pointing down-right (the "regression" arrow). */}
      <path
        d="M9 11 L16 18 L23 11"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 18 L16 25 L23 18"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="regress-bg" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
    </svg>
  );

  if (variant === 'icon') return <span className={className}>{icon}</span>;

  if (variant === 'wordmark' || variant === 'inverse') {
    const colour = variant === 'inverse' ? 'text-text-inverse' : 'text-text';
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        {icon}
        <span className={`text-lg font-bold tracking-tight ${colour}`}>Regress</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {icon}
      <span className="text-lg font-bold tracking-tight text-text">Regress</span>
    </span>
  );
}
