import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { applyTheme, HEX_RE, themeKey, type ThemeColors } from '../lib/universityTheme'
import { useAuth } from './AuthContext'
import { ThemeContext, type ThemeApi } from './UniversityThemeContext'

const cacheKey = (userId: string) => `campusbridge-theme:${userId}`

function readCache(userId: string): ThemeColors | null {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? 'null') as ThemeColors | null
    return v && [v.primary, v.pop, v.fresh].every((c) => HEX_RE.test(c)) ? v : null
  } catch {
    return null
  }
}

function writeCache(userId: string, colors: ThemeColors | null) {
  try {
    if (colors) localStorage.setItem(cacheKey(userId), JSON.stringify(colors))
    else localStorage.removeItem(cacheKey(userId))
  } catch {
    /* storage unavailable: the theme just loads a moment later next time */
  }
}

/**
 * Applies the university's colors for its clubs and administrator. Everyone
 * else (partners, site admins, logged-out visitors) sees CampusBridge colors.
 * The last colors are cached per user so pages open in the right colors; if
 * the server has different ones, the page re-renders once so charts pick them up.
 */
export function UniversityThemeProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const userId = session?.user.id ?? null
  const themed = profile?.role === 'club' || profile?.role === 'university_admin'
  const [colors, setColors] = useState<ThemeColors | null>(null)
  const [version, setVersion] = useState(0)
  const shown = useRef('')

  const show = useCallback((c: ThemeColors | null, rerender: boolean) => {
    const key = themeKey(c)
    if (key === shown.current) return
    applyTheme(c)
    shown.current = key
    if (rerender) setVersion((v) => v + 1)
  }, [])

  // Before paint: cached colors for this user (or defaults when signed out).
  useLayoutEffect(() => {
    const cached = userId ? readCache(userId) : null
    setColors(cached)
    show(cached, false)
  }, [userId, show])

  useEffect(() => {
    if (!userId || !profile) return
    if (!themed) {
      setColors(null)
      show(null, true)
      return
    }
    let cancelled = false
    void supabase.rpc('current_university_theme').then(({ data, error }) => {
      if (cancelled || error) return
      const d = data as ThemeColors | null
      const next = d && [d.primary, d.pop, d.fresh].every((c) => HEX_RE.test(c ?? '')) ? d : null
      writeCache(userId, next)
      setColors(next)
      show(next, true)
    })
    return () => { cancelled = true }
  }, [userId, profile, themed, show])

  // Stable functions that always use the latest saved colors.
  const saved = useRef<ThemeColors | null>(null)
  saved.current = colors
  const preview = useCallback((c: ThemeColors | null) => { applyTheme(c); shown.current = `preview:${themeKey(c)}` }, [])
  const endPreview = useCallback(() => { shown.current = 'preview'; show(saved.current, false) }, [show])
  const commit = useCallback((c: ThemeColors | null) => {
    if (userId) writeCache(userId, c)
    saved.current = c
    setColors(c)
    shown.current = 'preview'
    show(c, false)
  }, [userId, show])
  const api = useMemo<ThemeApi>(() => ({ colors, preview, endPreview, commit }), [colors, preview, endPreview, commit])

  return (
    <ThemeContext.Provider value={api}>
      <Fragment key={version}>{children}</Fragment>
    </ThemeContext.Provider>
  )
}
