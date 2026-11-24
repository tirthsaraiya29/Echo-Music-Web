import React from 'react'
import { AlertTriangle, RefreshCw, Trash2, Copy, Check } from 'lucide-react'

export interface GlobalErrorFallbackProps {
  error?: Error | null
  errorId?: string
  resetError?: () => void
}

export const GlobalErrorFallback: React.FC<GlobalErrorFallbackProps> = ({
  error,
  errorId,
  resetError,
}) => {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    const details = `Error ID: ${errorId || 'N/A'}\nMessage: ${error?.message || 'Unknown'}\nStack: ${error?.stack || 'N/A'}`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(details).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {})
    }
  }

  const handleHardRefresh = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  const handleClearCacheAndReload = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {}
      window.location.href = '/'
    }
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-screen w-full flex items-center justify-center bg-zinc-950 text-zinc-100 p-6"
    >
      <div className="max-w-md w-full rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl flex flex-col items-center text-center">
        <div className="p-3 bg-red-500/10 text-red-400 rounded-full mb-4">
          <AlertTriangle className="w-8 h-8" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-bold tracking-tight mb-2">Something went wrong</h1>
        <p className="text-sm text-zinc-400 mb-4">
          An unexpected error occurred. The details have been safely captured.
        </p>

        {errorId && (
          <div className="text-xs font-mono bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 mb-4 select-all">
            Reference ID: {errorId}
          </div>
        )}

        {error?.message && (
          <div className="text-xs text-red-300/80 bg-red-950/20 border border-red-900/30 p-3 rounded-lg w-full mb-6 text-left font-mono overflow-x-auto max-h-24">
            {error.message}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 w-full">
          {resetError ? (
            <button
              type="button"
              onClick={resetError}
              className="flex-1 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-white text-black font-medium text-sm hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          ) : (
            <button
              type="button"
              onClick={handleHardRefresh}
              className="flex-1 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-white text-black font-medium text-sm hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Reload app
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-sm transition-colors flex items-center justify-center gap-2"
            title="Copy error details"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <button
          type="button"
          onClick={handleClearCacheAndReload}
          className="mt-3 min-h-[44px] min-w-[44px] text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 py-2 px-3"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear local cache & reset
        </button>
      </div>
    </div>
  )
}
