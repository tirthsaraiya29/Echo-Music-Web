import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Home, Search, AlertCircle } from 'lucide-react'
import { recordRoutingMetric } from './routeTypes.ts'

export function NotFoundPage() {
  useEffect(() => {
    recordRoutingMetric('notFoundNavigations')
  }, [])

  return (
    <section
      className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center"
      aria-labelledby="not-found-heading"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ed5564]/15 text-[#ed5564]">
        <AlertCircle size={32} aria-hidden="true" />
      </div>
      <h1 id="not-found-heading" className="mt-4 text-2xl font-bold tracking-tight text-white">
        Page Not Found
      </h1>
      <p className="mt-2 max-w-md text-sm text-[#a59fad]">
        The page or media route you requested does not exist or may have moved.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg bg-[#8b79e8] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#8b79e8]/90"
        >
          <Home size={16} aria-hidden="true" />
          <span>Return Home</span>
        </Link>
        <Link
          to="/search"
          className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg bg-white/6 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
        >
          <Search size={16} aria-hidden="true" />
          <span>Search Music</span>
        </Link>
      </div>
    </section>
  )
}
