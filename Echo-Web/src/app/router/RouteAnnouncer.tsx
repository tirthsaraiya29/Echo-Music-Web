import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigationManager } from './NavigationManager.ts'

const routeTitles: Record<string, string> = {
  '/': 'Echo Music — Home',
  '/discover': 'Discover — Echo Music',
  '/search': 'Search — Echo Music',
  '/library': 'Your Library — Echo Music',
  '/liked': 'Liked Songs — Echo Music',
  '/recently-played': 'Recently Played — Echo Music',
  '/queue': 'Play Queue — Echo Music',
  '/podcasts': 'Podcasts — Echo Music',
  '/flow': 'Music Flow — Echo Music',
  '/settings': 'Settings — Echo Music',
}

export function RouteAnnouncer() {
  const location = useLocation()
  const [announcement, setAnnouncement] = useState('')
  const prevPathRef = useRef(location.pathname)

  useEffect(() => {
    const current = location.pathname
    const prev = prevPathRef.current

    navigationManager.recordNavigation(prev, current)
    prevPathRef.current = current

    const title = routeTitles[current] || 'Echo Music'
    document.title = title
    setAnnouncement(`Navigated to ${title}`)

    // Manage focus: move focus to main content on route change
    const mainContent = document.getElementById('main-content')
    if (mainContent) {
      mainContent.focus({ preventScroll: true })
    }
  }, [location.pathname])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {announcement}
    </div>
  )
}
