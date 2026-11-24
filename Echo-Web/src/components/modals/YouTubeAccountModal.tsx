/**
 * YouTube Music Account Connection Modal Component
 *
 * Implements session cookie authentication, validation, and multi-account
 * persistence matching upstream Echo Music architecture (LoginScreen.kt).
 */

import { useState } from 'react'
import { KeyRound, Loader2, Music2, ShieldCheck, X } from 'lucide-react'
import {
  validateAndConnectYouTubeAccount,
  type YouTubeAccountInfo,
} from '../../services/innertube/accountAuthService.ts'

interface YouTubeAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (accountInfo: YouTubeAccountInfo) => void
}

export function YouTubeAccountModal({ isOpen, onClose, onSuccess }: YouTubeAccountModalProps) {
  const [cookie, setCookie] = useState<string>('')
  const [visitorData, setVisitorData] = useState<string>('')
  const [dataSyncId, setDataSyncId] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cookie.trim()) {
      setErrorMessage('Please enter your YouTube Music session cookie.')
      return
    }

    setLoading(true)
    setErrorMessage(null)
    try {
      const info = await validateAndConnectYouTubeAccount(
        cookie.trim(),
        visitorData.trim() || undefined,
        dataSyncId.trim() || undefined,
      )
      onSuccess?.(info)
      onClose()
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to verify account credentials.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Connect YouTube Music Account"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#16141e] p-6 text-[#f4f1f7] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white"
          title="Close dialog"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/20 text-red-500">
            <Music2 size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">YouTube Music Account</h3>
            <p className="text-xs text-[#a59fad]">Authenticate for personal library & playlists</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-[#a59fad]">
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 text-emerald-400 shrink-0" />
            <p>
              Your session cookie is stored locally on your device in secure browser storage and is
              only transmitted to YouTube Music InnerTube to authenticate your personal library.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
          <div>
            <label htmlFor="ytm-cookie-input" className="block text-xs font-semibold text-white">
              Session Cookie (SAPISID, __Secure-3PSID, etc.)
            </label>
            <textarea
              id="ytm-cookie-input"
              rows={4}
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="Paste your YouTube Music cookie header here..."
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white placeholder-white/30 focus:border-red-500 focus:outline-none"
              required
            />
            <p className="mt-1 text-[11px] text-[#a59fad]">
              Obtain from <code className="text-white/80">music.youtube.com</code> via Browser
              Developer Tools → Network → Cookie header.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ytm-visitor-data" className="block text-xs font-medium text-[#a59fad]">
                Visitor Data (Optional)
              </label>
              <input
                id="ytm-visitor-data"
                type="text"
                value={visitorData}
                onChange={(e) => setVisitorData(e.target.value)}
                placeholder="X-YouTube-Visitor-Data"
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="ytm-datasync-id" className="block text-xs font-medium text-[#a59fad]">
                Data Sync ID (Optional)
              </label>
              <input
                id="ytm-datasync-id"
                type="text"
                value={dataSyncId}
                onChange={(e) => setDataSyncId(e.target.value)}
                placeholder="DataSyncId"
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2 text-xs font-semibold text-white transition-all hover:bg-red-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <KeyRound size={14} />
                  <span>Connect Account</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
