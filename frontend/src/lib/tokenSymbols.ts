/**
 * Known PulseChain token symbols by address (lowercase).
 * Used as fallback when DexScreener returns address instead of symbol.
 */
const KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
  // Native & core
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27': 'WPLS',
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': 'HEX',
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab': 'PLSX',
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': 'INC',
  '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11': 'PRVX',
  '0x347a96a5bd06d2e15199b032f46fb724d6c73047': 'LOAN',
  '0x832396a5e87efd5e437a7134e25e3e2c05c963be': 'MINT',
  '0x57fde0a71132198bbec939b98976993d8d89d225': 'eHEX',
  '0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b': 'ATROPA',
  // Bridged tokens
  '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c': 'WETH',
  '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f': 'USDT',
  '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07': 'USDC',
  '0xefd766ccb38eaf1dfd701853bfce31359239f305': 'DAI',
  '0xb17d901469b9208b17d916112988a3fed19b5ca1': 'WBTC',
  // Ethereum fork copies
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'AAVE',
  '0xc00e94cb662c3520282e6f5717214004a7f26888': 'COMP',
  '0xc011a747ee81f4a9b44e00b193a5ddf4b7d84ed0': 'SNX',
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 'CRV',
  '0x5a98fcbea516cf06857215779fd812ca3bef1b32': 'LDO',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'MATIC',
  '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': 'SUSHI',
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': 'MKR',
  '0x5ee84583f67d5ecea5420dbb42b462896e7f8d06': 'PEPE',
  '0x6386704cd6f7a584ea9d23ccca66af7eba5a727e': 'DOGE',
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 'SHIB',
  '0x5b218ed1428cfc1e488b777bdd473cf2647d30e3': 'PLSX',
  // Memes & others
  '0x26aff0e98e903de70d9e008b5c77ac746c3a7895': 'WHALE',
}

/**
 * Resolve a pool symbol that might be a raw address instead of a symbol name.
 * DexScreener sometimes returns the token address as the symbol.
 */
export function resolvePoolSymbol(
  symbol: string | null,
  address: string | null,
  contextTokenAddress?: string,
  contextTokenSymbol?: string,
): string {
  // Normal symbol — not an address
  if (symbol && !symbol.startsWith('0x')) return symbol
  // No symbol or address-like symbol: try to resolve from address
  const addr = (address || symbol || '').toLowerCase()
  if (!addr) return '???'
  // Check if it's the context token (currently selected/viewed)
  if (contextTokenAddress && addr === contextTokenAddress.toLowerCase() && contextTokenSymbol) {
    return contextTokenSymbol
  }
  // Look up in known tokens
  if (KNOWN_TOKEN_SYMBOLS[addr]) return KNOWN_TOKEN_SYMBOLS[addr]
  // Last resort: truncated address
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
