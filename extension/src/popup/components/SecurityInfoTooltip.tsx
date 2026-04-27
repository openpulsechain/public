import { useState, useEffect, useRef } from 'react'
import { Info } from 'lucide-react'

export function SecurityInfoTooltip() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // Delay to avoid immediate close from the same click
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="w-6 h-6 rounded-full border border-white/15 bg-white/5 flex items-center justify-center hover:bg-white/15 transition-colors"
        title="Security info"
      >
        <Info className="h-3.5 w-3.5 text-gray-400" />
      </button>

      {open && (
        <>
          {/* Backdrop blur */}
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />
        <div ref={panelRef} className="absolute z-50 left-1/2 -translate-x-1/2 bottom-12 w-[22rem] bg-[#0d0d20] border-2 border-[#00D4FF]/40 rounded-xl p-3.5 shadow-2xl shadow-[#00D4FF]/20">
          <div className="space-y-2 text-[11px] text-gray-300 leading-relaxed">
            <p className="font-semibold text-white text-xs text-center">How your password is protected</p>
            <ul className="space-y-1.5 list-none">
              <li className="flex gap-1.5">
                <span className="text-emerald-400 shrink-0">&#x2713;</span>
                <span>Password is <strong className="text-white">never stored</strong> — only a cryptographic hash (PBKDF2-SHA256, 100K iterations)</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-emerald-400 shrink-0">&#x2713;</span>
                <span>Unique <strong className="text-white">random salt</strong> (16 bytes) per installation — prevents rainbow table attacks</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-emerald-400 shrink-0">&#x2713;</span>
                <span><strong className="text-white">Brute-force protection</strong> — exponential delay after 3 failed attempts (up to 60s)</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-emerald-400 shrink-0">&#x2713;</span>
                <span>All data stays <strong className="text-white">local</strong> in your browser — nothing sent to any server</span>
              </li>
            </ul>
            <p className="text-gray-500 text-[10px] pt-2 mt-1 border-t border-[#00D4FF]/20 whitespace-nowrap">
              No password recovery — reset requires reinstalling the extension.
            </p>
          </div>
        </div>
        </>
      )}
    </>
  )
}
