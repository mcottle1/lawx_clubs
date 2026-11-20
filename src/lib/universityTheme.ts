// University colors: an administrator picks a primary color and two accents;
// we derive the full token scales used across the site (see index.css) and
// apply them only for accounts tied to that university (its clubs and admin).
//
// Every generated scale is checked against the text/background pairs the app
// actually uses, and nudged lighter or darker until each pair meets WCAG AA
// (4.5:1), so an administrator can't pick colors that make text unreadable.

export interface ThemeColors {
  primary: string
  pop: string
  fresh: string
}

export const DEFAULT_COLORS: ThemeColors = { primary: '#4a3ae0', pop: '#f0612e', fresh: '#0d9488' }

export const HEX_RE = /^#[0-9a-f]{6}$/i

// ---- color math (sRGB ↔ OKLab, for even-looking tints and shades) ---------

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

const toLinear = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function rgbToOklab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** Mixes `hex` toward white (t > 0) or black (t < 0) in OKLab; |t| = 1 is fully white/black. */
export function shade(hex: string, t: number): string {
  const [L, a, b] = rgbToOklab(hexToRgb(hex))
  const target = t >= 0 ? 1 : 0
  const k = Math.min(1, Math.abs(t))
  return rgbToHex(oklabToRgb([L + (target - L) * k, a * (1 - k), b * (1 - k)]))
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Darkens (or lightens, if `lighten`) `hex` in small steps until it reaches `ratio` against `against`. */
function ensure(hex: string, against: string, ratio: number, lighten = false): string {
  let out = hex
  for (let i = 1; i <= 40 && contrast(out, against) < ratio; i++) out = shade(hex, (lighten ? 1 : -1) * i * 0.025)
  return out
}

// ---- token scales ---------------------------------------------------------

const AA = 4.5

/**
 * Builds the CSS variables for a set of colors. The chosen primary becomes
 * accent-600 (buttons), each accent becomes pop-500 / fresh-600, adjusted only
 * as much as needed for readable text.
 */
export function buildTheme(colors: ThemeColors): Record<string, string> {
  const white = '#ffffff'
  // Primary: white text on accent-600 buttons; accent-700 links on white and on accent-50.
  const p600 = ensure(colors.primary, white, AA)
  const accent = {
    50: shade(p600, 0.93), 100: shade(p600, 0.86), 200: shade(p600, 0.7), 300: shade(p600, 0.5),
    500: shade(p600, 0.15), 600: p600, 700: '', 800: '', 900: '',
  } as Record<number, string>
  accent[900] = ensure(shade(p600, -0.52), white, 12)
  // accent-100 is also light text on accent-600 (message bubbles) and on accent-900 (landing).
  accent[100] = ensure(ensure(accent[100], p600, AA, true), accent[900], AA, true)
  accent[700] = ensure(shade(p600, -0.18), accent[100], AA)
  accent[800] = ensure(shade(p600, -0.35), accent[100], 7)

  // Accent 1 ("pop"): dark ink (accent-900) on pop-400 buttons; pop-700 text on white / pop-50.
  const pop500 = colors.pop
  const pop50 = shade(pop500, 0.93)
  const pop = {
    50: pop50, 100: shade(pop500, 0.85), 200: shade(pop500, 0.6),
    400: ensure(shade(pop500, 0.18), accent[900], AA, true),
    500: pop500,
    700: '',
  } as Record<number, string>
  pop[700] = ensure(shade(pop500, -0.25), pop[100], AA)
  pop[200] = ensure(pop[200], accent[900], AA, true) // highlighted words on dark backgrounds
  // Hover color for bright buttons: a little darker than pop-400, still readable with dark ink.
  const popHover = ensure(shade(pop[400], -0.08), accent[900], AA, true)

  // Accent 2 ("fresh"): fresh-700 text on white / fresh-50; fresh-600 for charts.
  const fresh600 = colors.fresh
  const fresh50 = shade(fresh600, 0.93)
  const fresh = {
    50: fresh50, 100: shade(fresh600, 0.82), 300: shade(fresh600, 0.45), 500: shade(fresh600, 0.15),
    600: fresh600,
    700: '',
  } as Record<number, string>
  fresh[700] = ensure(shade(fresh600, -0.18), fresh[100], AA)
  fresh[300] = ensure(fresh[300], accent[900], AA, true) // labels on dark backgrounds

  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(accent)) vars[`--color-accent-${k}`] = v
  for (const [k, v] of Object.entries(pop)) vars[`--color-pop-${k}`] = v
  for (const [k, v] of Object.entries(fresh)) vars[`--color-fresh-${k}`] = v
  vars['--color-pop-hover'] = popHover
  vars['--color-surface'] = shade(p600, 0.965)
  return vars
}

/** True when the generated colors differ visibly from what was picked (we adjusted for readability). */
export function adjustedForReadability(colors: ThemeColors): boolean {
  return buildTheme(colors)['--color-accent-600'].toLowerCase() !== colors.primary.toLowerCase()
}

// ---- applying -------------------------------------------------------------

let applied: string[] = []

/** Applies a theme to the whole page (null restores the CampusBridge colors). */
export function applyTheme(colors: ThemeColors | null): void {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  for (const name of applied) style.removeProperty(name)
  applied = []
  if (!colors) return
  for (const [name, value] of Object.entries(buildTheme(colors))) {
    style.setProperty(name, value)
    applied.push(name)
  }
}

/** A stable string for comparing themes ('' = default colors). */
export function themeKey(colors: ThemeColors | null): string {
  return colors ? `${colors.primary}${colors.pop}${colors.fresh}`.toLowerCase() : ''
}
