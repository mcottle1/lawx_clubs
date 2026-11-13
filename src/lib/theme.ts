/**
 * Reads a brand color from the CSS tokens in index.css, so charts and the
 * calendar use the same colors as the rest of the site (one place to change).
 */
export function cssVar(name: string, fallback = '#4a3ae0'): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export const brand = {
  primary: () => cssVar('--color-accent-600'),
  primaryLight: () => cssVar('--color-accent-100', '#e3e1ff'),
  pop: () => cssVar('--color-pop-500', '#f0612e'),
  fresh: () => cssVar('--color-fresh-600', '#0d9488'),
}
