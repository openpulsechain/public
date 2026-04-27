import { useState } from 'react'
import { Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { verifyPassword } from '../../lib/lock'
import { SecurityInfoTooltip } from './SecurityInfoTooltip'

interface LockScreenProps {
  onUnlock: () => void
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const handleUnlock = async () => {
    if (!password.trim()) return
    setLoading(true)
    setError('')

    const ok = await verifyPassword(password)
    setLoading(false)

    if (ok) {
      setPassword('')
      onUnlock()
    } else {
      const newAttempts = attempts + 1
      setAttempts(newAttempts)
      setPassword('')
      if (newAttempts >= 3) {
        const delay = Math.min(Math.pow(2, newAttempts - 3), 60)
        setError(`Wrong password. Wait ${delay}s before retry.`)
      } else {
        setError('Wrong password')
      }
    }
  }

  return (
    <div className="relative flex flex-col items-center justify-start pt-20 min-h-full h-full px-6 space-y-6 overflow-hidden">
      {/* OpenPulsechain branded background */}
      <div className="absolute inset-0 z-0 bg-[#0a0a1a]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(0,180,200,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,180,200,0.07) 1px, transparent 1px)
          `,
          backgroundSize: '18px 18px',
        }} />
        <div className="absolute -top-16 -right-16 w-60 h-60 bg-[#00B4C8]/20 rounded-full blur-[90px]" />
        <div className="absolute -bottom-24 -left-16 w-72 h-72 bg-[#8000E0]/25 rounded-full blur-[100px]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-40 h-40 bg-[#C020A0]/10 rounded-full blur-[70px]" />
      </div>

      {/* Logo */}
      <div className="relative z-10">
        <img src="/icons/logo.png" alt="OpenPulsechain" className="h-16 w-auto" />
      </div>

      <div className="relative z-10 text-center space-y-1">
        <h2 className="text-xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">OpenPulsechain Locked</h2>
        <p className="text-sm text-gray-500">Enter your password to unlock</p>
      </div>

      {/* Password input */}
      <div className="relative z-10 w-full max-w-[300px] space-y-4">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            placeholder="Password"
            autoFocus
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00D4FF]/50 pr-10"
          />
          <button
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={loading || !password.trim()}
          className="w-full rounded-xl bg-gradient-to-r from-[#00D4FF] to-[#8000E0] py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {loading ? 'Verifying...' : 'Unlock'}
        </button>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 max-w-[280px]">
        <p className="text-xs text-gray-600 text-center">
          Forgot password? Remove and reinstall the extension to reset.
        </p>
        <SecurityInfoTooltip />
      </div>
    </div>
  )
}
