import { Component, type ReactNode } from 'react'
import { RotateCcw, AlertTriangle } from 'lucide-react'
import { recordRoutingMetric } from './routeTypes.ts'

interface RouteErrorBoundaryProps {
  children: ReactNode
}

interface RouteErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  public constructor(props: RouteErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  public static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error }
  }

  public override componentDidCatch(error: Error): void {
    recordRoutingMetric('routeErrors')
    console.error('Route rendering error:', error)
  }

  public handleRetry = () => {
    this.setState({ hasError: false, error: null })
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <section
          role="alert"
          aria-live="assertive"
          className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
            <AlertTriangle size={28} aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Something went wrong loading this view</h2>
          <p className="mt-2 max-w-md text-sm text-[#a59fad]">
            An unexpected error occurred while rendering this route.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-6 flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg bg-[#8b79e8] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#8b79e8]/90"
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span>Reload Route</span>
          </button>
        </section>
      )
    }

    return this.props.children
  }
}
