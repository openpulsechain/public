import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Bell, Trash2, ExternalLink, Github, Lock, Eye, EyeOff, Activity } from 'lucide-react'
import { useStore } from '../../lib/store'
import { clearCache } from '../../lib/api'
import { shortenAddress } from '../../lib/format'
import { isLockConfigured, setPassword, updateTimeout, removeLock, getLockTimeout } from '../../lib/lock'
import { RpcStatusInline } from './RpcStatusInline'
import { SecurityInfoTooltip } from './SecurityInfoTooltip'

const TIMEOUT_OPTIONS = [
  { label: 'Never', value: 0 },
  { label: '1 min', value: 1 },
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
]

export function Settings() {
  const wallets = useStore((s) => s.wallets)
  const removeWallet = useStore((s) => s.removeWallet)
  const notifications = useStore((s) => s.notifications)
  const setNotifications = useStore((s) => s.setNotifications)
  const badgeAlerts = useStore((s) => s.badgeAlerts)
  const setBadgeAlerts = useStore((s) => s.setBadgeAlerts)

  // Lock state
  const [lockEnabled, setLockEnabled] = useState(false)
  const [lockTimeout, setLockTimeout] = useState(5)
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [lockMsg, setLockMsg] = useState('')

  useEffect(() => {
    isLockConfigured().then(setLockEnabled)
    getLockTimeout().then((t) => { if (t > 0) setLockTimeout(t) })
  }, [])

  const handleSetLock = async () => {
    if (newPassword.length < 4) {
      setLockMsg('Minimum 4 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setLockMsg('Passwords do not match')
      return
    }
    await setPassword(newPassword, lockTimeout)
    setLockEnabled(true)
    setShowSetPassword(false)
    setNewPassword('')
    setConfirmPassword('')
    setLockMsg('')
  }

  const handleRemoveLock = async () => {
    await removeLock()
    setLockEnabled(false)
    setLockMsg('')
  }

  const handleTimeoutChange = async (value: number) => {
    setLockTimeout(value)
    if (lockEnabled) await updateTimeout(value)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-4 w-4 text-pulse-cyan" />
        <h2 className="text-sm font-semibold text-white">Settings</h2>
      </div>

      {/* Lock */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-white">Auto-Lock</span>
            <SecurityInfoTooltip />
          </div>
          {lockEnabled ? (
            <button
              onClick={handleRemoveLock}
              className="px-2.5 py-1 rounded text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
            >
              Remove
            </button>
          ) : (
            <button
              onClick={() => setShowSetPassword(true)}
              className="px-2.5 py-1 rounded text-xs text-pulse-cyan border border-pulse-cyan/30 hover:bg-pulse-cyan/10 transition-colors"
            >
              Set Password
            </button>
          )}
        </div>

        {lockEnabled && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Lock after:</span>
            <select
              value={lockTimeout}
              onChange={(e) => handleTimeoutChange(Number(e.target.value))}
              className="bg-gray-900 border border-white/10 rounded px-2 py-0.5 text-xs text-gray-300"
            >
              {TIMEOUT_OPTIONS.filter(o => o.value > 0).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {showSetPassword && !lockEnabled && (
          <div className="space-y-2 pt-1">
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setLockMsg('') }}
                placeholder="New password (min 4 chars)"
                className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 pr-8"
              />
              <button onClick={() => setShowPw(!showPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600">
                {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setLockMsg('') }}
              placeholder="Confirm password"
              onKeyDown={(e) => e.key === 'Enter' && handleSetLock()}
              className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600"
            />
            {lockMsg && <p className="text-[10px] text-red-400">{lockMsg}</p>}
            <div className="flex gap-2">
              <button onClick={handleSetLock} className="flex-1 rounded-lg bg-pulse-cyan/20 text-pulse-cyan text-xs py-1.5 hover:bg-pulse-cyan/30 transition-colors">
                Enable Lock
              </button>
              <button onClick={() => { setShowSetPassword(false); setNewPassword(''); setConfirmPassword('') }} className="px-3 rounded-lg bg-gray-800 text-gray-400 text-xs py-1.5 hover:bg-gray-700 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-600">
          {lockEnabled
            ? 'Extension will lock after inactivity. Password required to unlock.'
            : 'Protect the extension with a password after inactivity.'}
        </p>
      </div>

      {/* Notifications */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-white">Push Notifications</span>
          </div>
          <button
            onClick={() => {
              setNotifications(!notifications)
              if (notifications) chrome.action?.setBadgeText?.({ text: '' })
            }}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              notifications ? 'bg-pulse-cyan' : 'bg-gray-700'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              notifications ? 'left-[18px]' : 'left-0.5'
            }`} />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Get notified when scam alerts are detected.
        </p>

        {/* Badge alert type filters */}
        {notifications && (
          <div className="space-y-2 pt-1 border-t border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider pt-2">Badge counts</p>
            {([
              { key: 'honeypot' as const, label: 'Honeypots', emoji: '🍯' },
              { key: 'lp_removal' as const, label: 'LP Removals', emoji: '🔴' },
              { key: 'whale_dump' as const, label: 'Whale Dumps', emoji: '🐋' },
              { key: 'mint_event' as const, label: 'Suspicious Mints', emoji: '🪙' },
            ]).map(({ key, label, emoji }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{emoji} {label}</span>
                <button
                  onClick={() => {
                    setBadgeAlerts({ ...badgeAlerts, [key]: !badgeAlerts[key] })
                    // Reset badge immediately so it recalculates on next cycle
                    chrome.action?.setBadgeText?.({ text: '' })
                  }}
                  className={`relative w-8 h-4 rounded-full transition-colors ${
                    badgeAlerts[key] ? 'bg-pulse-cyan' : 'bg-gray-700'
                  }`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                    badgeAlerts[key] ? 'left-[14px]' : 'left-0.5'
                  }`} />
                </button>
              </div>
            ))}
            <p className="text-[10px] text-gray-600">
              Only selected types will count in the badge number.
            </p>
          </div>
        )}
      </div>

      {/* Managed wallets */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
        <div className="text-sm text-gray-300 font-medium mb-2">Watched Wallets</div>
        {wallets.length === 0 ? (
          <p className="text-xs text-gray-500">No wallets added. Go to Portfolio to add one.</p>
        ) : (
          <div className="space-y-1.5">
            {wallets.map((w) => (
              <div key={w.address} className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-white">{w.label}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{shortenAddress(w.address, 6)}</div>
                </div>
                <button
                  onClick={() => removeWallet(w.address)}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RPC & Indexers Status */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-pulse-cyan" />
          <span className="text-sm font-medium text-white">Status RPC & Indexers</span>
        </div>
        <RpcStatusInline />
      </div>

      {/* Cache */}
      <div className="bg-gray-800/30 rounded-lg p-3 border border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-300 font-medium">Clear Cache</div>
            <p className="text-xs text-gray-500 mt-0.5">Force refresh all data from APIs.</p>
          </div>
          <button
            onClick={clearCache}
            className="px-2.5 py-1 rounded-md bg-gray-700 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Links */}
      <div className="space-y-1.5 pt-2">
        <a href="https://www.openpulsechain.com" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-pulse-cyan transition-colors">
          <ExternalLink className="h-3.5 w-3.5" /> OpenPulsechain Dashboard
        </a>
        <a href="https://www.openpulsechain.com/api" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-pulse-cyan transition-colors">
          <ExternalLink className="h-3.5 w-3.5" /> MCP / API Documentation
        </a>
        <a href="https://github.com/openpulsechain/openpulsechain" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-pulse-cyan transition-colors">
          <Github className="h-3.5 w-3.5" /> Source Code (MIT)
        </a>
      </div>

      <div className="text-center text-xs text-gray-600 pt-2">
        OpenPulsechain Extension v1.0.2
      </div>
    </div>
  )
}
