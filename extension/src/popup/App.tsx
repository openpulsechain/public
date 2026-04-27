import { useEffect, useState, useCallback, Component, type ReactNode, type ErrorInfo } from 'react'
import { useStore } from '../lib/store'
import { Header } from './components/Header'
import { Dashboard } from './components/Dashboard'
import { SafetyCheck } from './components/SafetyCheck'
import { Portfolio } from './components/Portfolio'
import { Bridge } from './components/Bridge'
import { Explorer } from './components/Explorer'
import { SmartMoney } from './components/SmartMoney'
import { Leagues } from './components/Leagues'
import { Alerts } from './components/Alerts'
import { Settings } from './components/Settings'
import { TokenDetail } from './components/TokenDetail'
import { BottomNav } from './components/BottomNav'
import { LockScreen } from './components/LockScreen'
import { SetupScreen } from './components/SetupScreen'
import { isLockConfigured, shouldLock, touchActivity } from '../lib/lock'

// Error boundary — prevents black screen on React crash
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OpenPulsechain] React crash:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-[#050510] text-white p-6 text-center">
          <div className="text-2xl font-bold text-red-400 mb-2">Something went wrong</div>
          <p className="text-xs text-gray-400 mb-4">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg bg-pulse-cyan/20 text-pulse-cyan text-xs font-medium hover:bg-pulse-cyan/30 transition-colors"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const SETUP_DONE_KEY = 'op_setup_done'

export function App() {
  const activeSection = useStore((s) => s.activeSection)
  const loadWallets = useStore((s) => s.loadWallets)
  const loadSettings = useStore((s) => s.loadSettings)

  const [locked, setLocked] = useState(false)
  const [lockChecked, setLockChecked] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  // Check lock state + first launch on open
  useEffect(() => {
    (async () => {
      // Check if setup was completed
      const storage = await chrome.storage.local.get(SETUP_DONE_KEY)
      if (!storage[SETUP_DONE_KEY]) {
        setNeedsSetup(true)
        setLockChecked(true)
        return
      }

      const configured = await isLockConfigured()
      if (configured) {
        // Check both shouldLock (time-based) and force_lock flag (set by service worker)
        const forceFlag = await chrome.storage.local.get('op_force_lock')
        const needsLock = await shouldLock()
        if (needsLock || forceFlag['op_force_lock']) {
          setLocked(true)
          await chrome.storage.local.remove('op_force_lock')
        }
      }
      setLockChecked(true)
    })()
  }, [])

  const handleSetupComplete = async () => {
    await chrome.storage.local.set({ [SETUP_DONE_KEY]: true })
    setNeedsSetup(false)
    touchActivity()
  }

  // Track activity on every interaction
  const handleActivity = useCallback(() => { touchActivity() }, [])

  useEffect(() => {
    if (lockChecked && !locked && !needsSetup) {
      touchActivity()
      window.addEventListener('click', handleActivity)
      window.addEventListener('keydown', handleActivity)
      return () => {
        window.removeEventListener('click', handleActivity)
        window.removeEventListener('keydown', handleActivity)
      }
    }
  }, [lockChecked, locked, needsSetup, handleActivity])

  useEffect(() => {
    loadWallets()
    loadSettings()
  }, [loadWallets, loadSettings])

  if (!lockChecked) return null

  if (needsSetup) {
    return <SetupScreen onComplete={handleSetupComplete} />
  }

  if (locked) {
    return <LockScreen onUnlock={() => { setLocked(false); touchActivity(); chrome.storage.local.remove('op_force_lock') }} />
  }

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full min-h-[500px] bg-[#050510] relative overflow-hidden">
      {/* PulseChain Aurora Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {/* Cyan */}
        <div
          className="absolute -top-[80px] -right-[40px] w-[280px] h-[280px] bg-[#00D4FF]/15 rounded-full blur-[80px]"
          style={{ animation: 'liquid-1 20s ease-in-out infinite' }}
        />
        {/* Crimson/Rose */}
        <div
          className="absolute -bottom-[40px] -left-[80px] w-[240px] h-[320px] bg-[#FF0040]/10 rounded-full blur-[90px]"
          style={{ animation: 'liquid-2 25s ease-in-out infinite', animationDelay: '2s' }}
        />
        {/* Blue Royal */}
        <div
          className="absolute -top-[40px] left-[60px] w-[200px] h-[200px] bg-[#4040E0]/15 rounded-full blur-[70px]"
          style={{ animation: 'liquid-3 22s ease-in-out infinite', animationDelay: '5s' }}
        />
        {/* Violet */}
        <div
          className="absolute -bottom-[80px] right-[40px] w-[240px] h-[240px] bg-[#8000E0]/20 rounded-full blur-[80px]"
          style={{ animation: 'liquid-1 28s ease-in-out infinite', animationDelay: '1s', animationDirection: 'reverse' }}
        />
        {/* Magenta */}
        <div
          className="absolute top-[120px] left-[100px] w-[160px] h-[160px] bg-[#D000C0]/10 rounded-full blur-[90px]"
          style={{ animation: 'liquid-2 30s ease-in-out infinite', animationDelay: '7s' }}
        />
      </div>

      {/* Content — above aurora */}
      <div className="flex flex-col h-full relative z-10">
        <Header />
        <main className="flex-1 overflow-y-auto p-3 pb-14">
          {activeSection === 'dashboard' && <Dashboard />}
          {activeSection === 'safety' && <SafetyCheck />}
          {activeSection === 'portfolio' && <Portfolio />}
          {activeSection === 'bridge' && <Bridge />}
          {activeSection === 'explorer' && <Explorer />}
          {activeSection === 'smartmoney' && <SmartMoney />}
          {activeSection === 'leagues' && <Leagues />}
          {activeSection === 'alerts' && <Alerts />}
          {activeSection === 'settings' && <Settings />}
          {activeSection === 'token-detail' && <TokenDetail />}
        </main>
        <div className="fixed bottom-0 left-0 right-0 z-20">
          <BottomNav />
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}
