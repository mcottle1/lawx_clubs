import { describe, expect, it } from 'vitest'
import { buildTheme, contrast, DEFAULT_COLORS, type ThemeColors } from './universityTheme'

// Text/background pairs used in the app (text, background, minimum ratio).
const PAIRS: [string, string, number][] = [
  ['#ffffff', 'accent-600', 4.5], // primary buttons
  ['accent-700', '#ffffff', 4.5], // links
  ['accent-700', 'accent-50', 4.5], // info alerts, ghost buttons
  ['accent-700', 'accent-100', 4.5], // badges
  ['accent-800', '#ffffff', 7], // active tab
  ['accent-900', '#ffffff', 7], // headings
  ['accent-900', 'pop-400', 4.5], // bright call-to-action buttons
  ['accent-900', 'pop-hover', 4.5], // their hover state
  ['accent-100', 'accent-600', 4.5], // timestamps in my message bubbles
  ['pop-700', '#ffffff', 4.5],
  ['pop-700', 'pop-50', 4.5], // "sent back" notices
  ['pop-700', 'pop-100', 4.5], // "changes requested" badges
  ['fresh-700', '#ffffff', 4.5],
  ['fresh-700', 'fresh-50', 4.5],
  ['fresh-700', 'fresh-100', 4.5],
  ['accent-100', 'accent-900', 4.5], // landing hero text
  ['pop-200', 'accent-900', 4.5],
  ['fresh-300', 'accent-900', 4.5],
  ['pop-400', 'accent-900', 4.5], // logo on dark backgrounds
]

const SAMPLES: ThemeColors[] = [
  DEFAULT_COLORS,
  { primary: '#002e5d', pop: '#ffc72c', fresh: '#6cace4' }, // navy / gold / light blue
  { primary: '#cc0000', pop: '#ffffff', fresh: '#000000' },
  { primary: '#ffff00', pop: '#00ff00', fresh: '#ff00ff' }, // very light picks
  { primary: '#ffffff', pop: '#f5f5f5', fresh: '#fafafa' },
  { primary: '#000000', pop: '#111111', fresh: '#222222' }, // very dark picks
  { primary: '#bfa5e8', pop: '#a8e6cf', fresh: '#ffd3b6' }, // pastels
  { primary: '#808080', pop: '#808080', fresh: '#808080' },
]

describe('buildTheme', () => {
  for (const colors of SAMPLES) {
    it(`keeps every text pair readable for ${colors.primary} / ${colors.pop} / ${colors.fresh}`, () => {
      const vars = buildTheme(colors)
      const get = (c: string) => (c.startsWith('#') ? c : vars[`--color-${c}`])
      for (const [fg, bg, min] of PAIRS) {
        const ratio = contrast(get(fg), get(bg))
        expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(min)
      }
    })
  }

  it('keeps the picked colors when they are already readable', () => {
    const vars = buildTheme({ primary: '#002e5d', pop: '#ffc72c', fresh: '#0d9488' })
    expect(vars['--color-accent-600']).toBe('#002e5d')
    expect(vars['--color-pop-500']).toBe('#ffc72c')
    expect(vars['--color-fresh-600']).toBe('#0d9488')
  })

  it('darkens a primary that is too light for white button text', () => {
    const vars = buildTheme({ primary: '#ffff00', pop: '#ff7a4d', fresh: '#0d9488' })
    expect(vars['--color-accent-600']).not.toBe('#ffff00')
    expect(contrast('#ffffff', vars['--color-accent-600'])).toBeGreaterThanOrEqual(4.5)
  })
})
