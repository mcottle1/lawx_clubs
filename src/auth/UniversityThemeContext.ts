import { createContext, useContext } from 'react'
import type { ThemeColors } from '../lib/universityTheme'

export interface ThemeApi {
  /** The signed-in user's university colors (null = CampusBridge colors). */
  colors: ThemeColors | null
  /** Shows colors on the page without saving them (null = default colors). */
  preview: (colors: ThemeColors | null) => void
  /** Stops previewing and goes back to the saved colors. */
  endPreview: () => void
  /** Records newly saved colors and keeps showing them. */
  commit: (colors: ThemeColors | null) => void
}

export const ThemeContext = createContext<ThemeApi | null>(null)

export function useUniversityTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useUniversityTheme must be used inside UniversityThemeProvider')
  return ctx
}
