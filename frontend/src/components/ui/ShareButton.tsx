import { useState } from 'react'
import { Share2, Check, Copy } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface ShareButtonProps {
  title: string
  text?: string
  className?: string
}

export function ShareButton({ title, text, className = '' }: ShareButtonProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  const url = window.location.href

  function shareTwitter() {
    const tweetText = `${title}${text ? ` - ${text}` : ''}`
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(url)}`,
      '_blank',
      'width=550,height=420'
    )
    setOpen(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => { setCopied(false); setOpen(false) }, 1500)
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
      >
        <Share2 className="h-3.5 w-3.5" />
        {t.common.share}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-48 rounded-xl border border-white/10 bg-gray-950/95 backdrop-blur-xl shadow-2xl py-1">
            <button
              onClick={shareTwitter}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              {t.common.post_on_x}
            </button>
            <button
              onClick={copyLink}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? t.common.copied : t.common.copy_link}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
