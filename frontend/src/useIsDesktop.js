import { useEffect, useState } from 'react'

/**
 * True when the viewport is desktop-sized (>= 1024px). The app is
 * mobile-first; desktop gets a top nav and wider layouts.
 */
export function useIsDesktop(breakpoint = 1024) {
  const query = `(min-width: ${breakpoint}px)`
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e) => setIsDesktop(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return isDesktop
}
