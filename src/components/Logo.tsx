/** CampusBridge mark + wordmark. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="cb-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-accent-500)" />
          <stop offset="1" stopColor="var(--color-accent-800)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#cb-logo-g)" />
      <path d="M5 21.5 Q16 7 27 21.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M4.5 22.5 H27.5" stroke="var(--color-pop-400)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M11 14.5 V22.5 M16 11.8 V22.5 M21 14.5 V22.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
    </svg>
  )
}

export default function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className={`text-lg font-extrabold tracking-tight ${inverted ? 'text-white' : 'text-accent-900'}`}>
        Campus<span className={inverted ? 'text-pop-400' : 'text-brand-gradient'}>Bridge</span>
      </span>
    </span>
  )
}
