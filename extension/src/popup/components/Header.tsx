import { Search } from 'lucide-react'
import { useStore } from '../../lib/store'
import { RpcStatus } from './RpcStatus'

export function Header() {
  const setActiveSection = useStore((s) => s.setActiveSection)

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5 bg-gray-900/60">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setActiveSection('dashboard')}
      >
        <img src="/icons/logo.png" alt="OpenPulsechain" className="h-6 w-auto" />
        <span className="text-sm font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">OpenPulsechain</span>
      </div>

      <div className="flex items-center gap-1">
        <RpcStatus />
        <button
          onClick={() => setActiveSection('explorer')}
          className="p-1.5 rounded-md text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
          title="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
