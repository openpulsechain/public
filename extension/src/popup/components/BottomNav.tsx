import { useState } from 'react'
import { Home, Wallet, ArrowLeftRight, Shield, MoreHorizontal, Search, TrendingUp, AlertTriangle, Crown, Settings, X } from 'lucide-react'
import { useStore, type Section } from '../../lib/store'

const MAIN_TABS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Overview', icon: <Home className="h-5 w-5" /> },
  { id: 'portfolio', label: 'Portfolio', icon: <Wallet className="h-5 w-5" /> },
  { id: 'bridge', label: 'Bridge', icon: <ArrowLeftRight className="h-5 w-5" /> },
  { id: 'safety', label: 'Safety', icon: <Shield className="h-5 w-5" /> },
]

const MORE_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'leagues', label: 'Leagues', icon: <Crown className="h-4 w-4" /> },
  { id: 'smartmoney', label: 'Money Tracker', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'alerts', label: 'Alerts', icon: <AlertTriangle className="h-4 w-4" /> },
  { id: 'explorer', label: 'Explorer', icon: <Search className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
]

export function BottomNav() {
  const activeSection = useStore((s) => s.activeSection)
  const setActiveSection = useStore((s) => s.setActiveSection)
  const [moreOpen, setMoreOpen] = useState(false)

  const isMoreActive = MORE_ITEMS.some((item) => item.id === activeSection)

  const handleMore = () => {
    setMoreOpen(!moreOpen)
  }

  const handleSelect = (id: Section) => {
    setActiveSection(id)
    setMoreOpen(false)
  }

  return (
    <div className="relative">
      {/* More popup */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
          {/* Sheet */}
          <div className="absolute bottom-full right-2 mb-2 z-50 w-44 rounded-lg border border-white/10 bg-gray-900/95 backdrop-blur shadow-2xl overflow-hidden">
            {MORE_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors ${
                  activeSection === item.id
                    ? 'bg-pulse-cyan/10 text-pulse-cyan'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-around px-2 py-1.5 bg-gray-900/95 backdrop-blur border-t border-white/5">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { handleSelect(tab.id) }}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-md transition-colors ${
              activeSection === tab.id ? 'text-pulse-cyan' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.icon}
            <span className="text-[10px] leading-tight">{tab.label}</span>
          </button>
        ))}
        {/* More button */}
        <button
          onClick={handleMore}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-md transition-colors ${
            isMoreActive || moreOpen ? 'text-pulse-cyan' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
          <span className="text-[10px] leading-tight">More</span>
        </button>
      </div>
    </div>
  )
}
