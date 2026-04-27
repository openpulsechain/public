import { useState, useEffect, useMemo } from 'react'
import { keccak256 } from 'js-sha3'

function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '')
  const hash = keccak256(addr)
  let checksummed = '0x'
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i]
  }
  return checksummed
}

const SIZE_CLASSES = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
} as const

interface TokenLogoProps {
  address: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Token logo with 3-source fallback cascade:
 * PulseX CDN → Piteas GitHub → DexScreener
 *
 * SINGLE SOURCE OF TRUTH — toutes les pages DOIVENT utiliser ce composant.
 * Ne JAMAIS dupliquer cette logique dans un fichier page.
 */
export function TokenLogo({ address, size = 'sm' }: TokenLogoProps) {
  const checksummed = useMemo(() => toChecksumAddress(address), [address])
  const sizeClass = SIZE_CLASSES[size]

  const urls = useMemo(() => [
    `https://tokens.app.pulsex.com/images/tokens/${checksummed}.png`,
    `https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/${checksummed}.png`,
    `https://dd.dexscreener.com/ds-data/tokens/pulsechain/${address.toLowerCase()}.png`,
  ], [checksummed, address])

  const [urlIndex, setUrlIndex] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setUrlIndex(0); setFailed(false) }, [address])

  if (failed || urlIndex >= urls.length) {
    return <div className={`${sizeClass} rounded-full bg-gray-800 border border-white/10 shrink-0`} />
  }

  return (
    <img
      src={urls[urlIndex]}
      alt=""
      className={`${sizeClass} rounded-full bg-gray-800 border border-white/10 shrink-0`}
      onError={() => {
        if (urlIndex + 1 < urls.length) setUrlIndex(urlIndex + 1)
        else setFailed(true)
      }}
    />
  )
}
