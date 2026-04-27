import { useTranslation } from '../../i18n'

const TOKEN_ICONS = [
  { symbol: 'PLS', src: '/tokens/pls.png' },
  { symbol: 'PLSX', src: '/tokens/plsx.png' },
  { symbol: 'HEX', src: '/tokens/phex.png' },
  { symbol: 'INC', src: '/tokens/inc.png' },
  { symbol: 'PRVX', src: '/tokens/prvx.png' },
]

export function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-white/5 py-6 text-center text-sm text-gray-500">
      {/* Token icons + on-chain badge */}
      <div className="flex items-center justify-center gap-2 mb-4">
        {TOKEN_ICONS.map(({ symbol, src }) => (
          <img key={symbol} src={src} alt={symbol} className="h-6 w-6 rounded-full opacity-40" />
        ))}
        <span className="text-[10px] text-gray-600 ml-2">{t.leagues.footer_onchain}</span>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-600 mb-4">
        {t.common.disclaimer}
      </p>

      {/* Links */}
      <p>
        {t.footer.about}{' '}
        <a
          href="https://github.com/openpulsechain/public"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-[#00D4FF] transition-colors"
        >
          GitHub
        </a>
        {' | '}
        <a
          href="https://x.com/openpulsechain"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-[#00D4FF] transition-colors"
        >
          X/Twitter
        </a>
        {' | '}
        <a
          href="https://dune.com/openpulsechain/pulsechain-bridge-analytics"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-[#00D4FF] transition-colors"
        >
          Dune Dashboard
        </a>
      </p>
    </footer>
  )
}
