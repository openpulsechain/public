import { useState } from 'react'
import { Eye, EyeOff, ChevronRight, Shield, AlertTriangle, TrendingUp, ArrowLeftRight } from 'lucide-react'
import { setPassword } from '../../lib/lock'
import { SecurityInfoTooltip } from './SecurityInfoTooltip'

const TIMEOUT_OPTIONS = [
  { label: '1 min', value: 1 },
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
]

interface SetupScreenProps {
  onComplete: () => void
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [step, setStep] = useState<'welcome' | 'password'>('welcome')
  const [pw, setPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [timeout, setTimeout_] = useState(5)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (pw.length < 4) { setError('Minimum 4 characters'); return }
    if (pw !== confirmPw) { setError('Passwords do not match'); return }
    setLoading(true)
    await setPassword(pw, timeout)
    setLoading(false)
    onComplete()
  }

  const handleSkip = () => {
    onComplete()
  }

  return (
    <div className="relative flex flex-col items-center min-h-full h-full px-6 overflow-hidden">
      {/* OpenPulsechain branded background — dark grid + teal/violet glows */}
      <div className="absolute inset-0 z-0 bg-[#0a0a1a]">
        {/* Fine grid lines (teal tint) */}
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(0,180,200,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,180,200,0.07) 1px, transparent 1px)
          `,
          backgroundSize: '18px 18px',
        }} />
        {/* Top-right teal glow */}
        <div className="absolute -top-16 -right-16 w-60 h-60 bg-[#00B4C8]/20 rounded-full blur-[90px]" />
        {/* Bottom-left magenta/violet glow */}
        <div className="absolute -bottom-24 -left-16 w-72 h-72 bg-[#8000E0]/25 rounded-full blur-[100px]" />
        {/* Center subtle purple */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-40 h-40 bg-[#C020A0]/10 rounded-full blur-[70px]" />
        {/* Bottom-right deep teal */}
        <div className="absolute bottom-10 right-0 w-48 h-48 bg-[#006068]/15 rounded-full blur-[80px]" />
      </div>

      {/* Header — fixed top */}
      <div className="relative z-10 w-full max-w-[320px] text-center space-y-3 pt-14">
        <img src="/icons/logo.png" alt="OpenPulsechain" className="mx-auto h-16 w-auto" />
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">OpenPulsechain</h1>
          <p className="text-sm text-gray-400 mt-1">Token safety, scam detection & portfolio tracker for PulseChain</p>
        </div>
      </div>

      {/* Welcome content — features + actions as separate blocks, vertically centered */}
      {step === 'welcome' && (
        <>
          <div className="flex-1" />
          <div className="relative z-10 w-full max-w-[320px] space-y-6">
            {/* Features */}
            <div className="space-y-1.5 w-full">
              {[
                { icon: <Shield className="h-4 w-4 text-[#00D4FF]" />, text: 'Real-time token safety scoring' },
                { icon: <AlertTriangle className="h-4 w-4 text-amber-400" />, text: 'Transaction guard on PulseX' },
                { icon: <TrendingUp className="h-4 w-4 text-emerald-400" />, text: 'Smart money & whale tracking' },
                { icon: <ArrowLeftRight className="h-4 w-4 text-purple-400" />, text: 'Bridge monitor & scam alerts' },
              ].map((f) => (
                <div key={f.text} className="flex items-center justify-center gap-2.5 py-0.5">
                  {f.icon}
                  <span className="text-[13px] text-gray-300">{f.text}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-10 w-full">
              <button
                onClick={() => setStep('password')}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#00D4FF] to-[#8000E0] py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Secure with Password
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={handleSkip}
                className="w-full rounded-xl border border-white/10 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
          <div className="flex-[2]" />
        </>
      )}

      {/* Password step */}
      {step === 'password' && (
        <div className="relative z-10 w-full max-w-[320px] space-y-3 mt-auto mb-auto py-4">
          <div className="text-center space-y-0.5">
            <div className="flex items-center justify-center gap-1.5">
              <h2 className="text-base font-bold text-white">Create Password</h2>
              <SecurityInfoTooltip />
            </div>
            <p className="text-xs text-gray-500">Your extension will lock after inactivity</p>
          </div>

          <div className="space-y-2.5 w-full">
            <div className="relative w-full">
              <input
                type={showPw ? 'text' : 'password'}
                value={pw}
                onChange={(e) => { setPw(e.target.value); setError('') }}
                placeholder="Password (min 4 chars)"
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#00D4FF]/50 pr-10"
              />
              <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Confirm password"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#00D4FF]/50"
            />

            {/* Timeout selector */}
            <div className="flex items-center justify-between bg-white/[0.03] rounded-xl px-3 py-2 border border-white/5">
              <span className="text-xs text-gray-400">Auto-lock after</span>
              <select
                value={timeout}
                onChange={(e) => setTimeout_(Number(e.target.value))}
                className="bg-transparent text-xs text-[#00D4FF] font-medium focus:outline-none cursor-pointer"
              >
                {TIMEOUT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value} className="bg-gray-900">{o.label}</option>
                ))}
              </select>
            </div>

            {error && <p className="text-xs text-red-400 text-center">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-[#00D4FF] to-[#8000E0] py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {loading ? 'Creating...' : 'Enable Protection'}
            </button>

            <button
              onClick={() => setStep('welcome')}
              className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors py-0.5"
            >
              ← Back
            </button>
          </div>

        </div>
      )}

      <p className="absolute bottom-4 left-0 right-0 z-10 text-xs text-gray-600 text-center">
        v1.0.2 — Open-source, no tracking, 100% on-chain data
      </p>
    </div>
  )
}
