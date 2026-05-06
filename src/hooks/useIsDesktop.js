import { useEffect, useState } from 'preact/hooks'

const QUERY = '(min-width: 768px)'

function readMatch() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(readMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mql = window.matchMedia(QUERY)
    const handler = (e) => setIsDesktop(e.matches)
    setIsDesktop(mql.matches)
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else if (mql.addListener) mql.addListener(handler)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else if (mql.removeListener) mql.removeListener(handler)
    }
  }, [])

  return isDesktop
}
