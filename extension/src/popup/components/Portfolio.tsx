import { useState, useEffect } from 'react'
import { Wallet, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../../lib/store'
import { WalletDetailView } from './WalletDetailView'

/**
 * Portfolio = multi-wallet shell: tabs + add/remove form.
 * Single-wallet rendering (balances, ranks, history, allocation, overview)
 * is delegated to <WalletDetailView/>, which is also reused by Explorer.
 */
export function Portfolio() {
  const wallets = useStore((s) => s.wallets)
  const addWallet = useStore((s) => s.addWallet)
  const removeWallet = useStore((s) => s.removeWallet)
  const [input, setInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [activeWallet, setActiveWallet] = useState<string | null>(null)

  useEffect(() => {
    if (wallets.length > 0 && !activeWallet) {
      setActiveWallet(wallets[0].address)
    }
    if (wallets.length === 0) {
      setActiveWallet(null)
    } else if (activeWallet && !wallets.some(w => w.address === activeWallet)) {
      setActiveWallet(wallets[0].address)
    }
  }, [wallets])

  const handleAdd = () => {
    const addr = input.trim().toLowerCase()
    if (!addr.match(/^0x[a-f0-9]{40}$/)) return
    addWallet(addr, labelInput.trim() || undefined)
    setInput('')
    setLabelInput('')
    setShowAdd(false)
    setActiveWallet(addr)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-pulse-cyan" />
          <h2 className="text-sm font-semibold text-white">Portfolio</h2>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {/* Add wallet form */}
      {showAdd && (
        <div className="bg-gray-800/40 rounded-lg p-2.5 space-y-2 border border-white/5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Wallet address (0x...)"
            className="w-full bg-gray-900/60 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-pulse-cyan/50"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Label (optional)"
              className="flex-1 bg-gray-900/60 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-pulse-cyan/50"
            />
            <button
              onClick={handleAdd}
              className="px-3 py-1.5 rounded-md bg-pulse-cyan/20 text-pulse-cyan text-xs font-medium hover:bg-pulse-cyan/30 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Wallet tabs */}
      {wallets.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {wallets.map((w) => (
            <button
              key={w.address}
              onClick={() => setActiveWallet(w.address)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                activeWallet === w.address
                  ? 'bg-pulse-cyan/15 text-pulse-cyan border border-pulse-cyan/30'
                  : 'bg-gray-800/40 text-gray-400 border border-white/5 hover:border-white/10'
              }`}
            >
              {w.label}
              <button
                onClick={(e) => { e.stopPropagation(); removeWallet(w.address) }}
                className="ml-0.5 text-gray-600 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </button>
          ))}
        </div>
      )}

      {wallets.length === 0 && !showAdd && (
        <div className="text-center py-8">
          <Wallet className="h-8 w-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">No wallets added yet</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-2 text-xs text-pulse-cyan hover:underline"
          >
            Add your first wallet
          </button>
        </div>
      )}

      {/* Single-wallet view — reused by Explorer */}
      {activeWallet && <WalletDetailView address={activeWallet} />}
    </div>
  )
}
