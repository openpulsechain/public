/**
 * Hook to fetch stablecoin market cap on PulseChain.
 *
 * Uses RPC totalSupply() for accurate on-chain supply (not inflated Supabase mcap),
 * combined with Supabase price data for USD value calculation.
 * Logos from PulseX CDN with checksummed addresses.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { keccak256 } from 'js-sha3'

const RPC = 'https://rpc.pulsechain.com'
const TOTAL_SUPPLY_SELECTOR = '0x18160ddd'

export interface StablecoinData {
  symbol: string
  name: string
  address: string
  price: number
  supply: number
  marketCap: number
  logo: string
}

// Curated stablecoin list — symbol/name hardcoded as fallback (some tokens missing from database)
const STABLECOINS = [
  { address: '0xefd766ccb38eaf1dfd701853bfce31359239f305', decimals: 18, symbol: 'DAI',   name: 'Dai Stablecoin from Ethereum' },
  { address: '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07', decimals: 6,  symbol: 'USDC',  name: 'USD Coin from Ethereum' },
  { address: '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f', decimals: 6,  symbol: 'USDT',  name: 'Tether USD from Ethereum' },
  { address: '0x0deed1486bc52aa0d3e6f8849cec5add6598a162', decimals: 18, symbol: 'USDL',  name: 'USDL Stablecoin' },
  { address: '0xeb6b7932da20c6d7b3a899d5887d86dfb09a6408', decimals: 18, symbol: 'PXDC',  name: 'PXDC Stablecoin' },
  { address: '0x1fe0319440a672526916c232eaee4808254bdb00', decimals: 8,  symbol: 'HEXDC', name: 'HEXDC Stablecoin' },
  { address: '0x144cd22aaa2a80fed0bb8b1deaddc51a53df1d50', decimals: 18, symbol: 'INCD',  name: 'INC Dollar' },
  { address: '0xa5b0d537cebe97f087dc5fe5732d70719caaec1d', decimals: 6,  symbol: 'hUSDC', name: 'USDC from Hyperlane' },
]

function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '')
  const hash = keccak256(addr)
  let checksummed = '0x'
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i]
  }
  return checksummed
}

// Tokens not on PulseX CDN — use local logos
const LOGO_OVERRIDES: Record<string, string> = {
  '0x1fe0319440a672526916c232eaee4808254bdb00': '/tokens/hexdc.png',
  '0x144cd22aaa2a80fed0bb8b1deaddc51a53df1d50': '/tokens/incd.png',
  '0xa5b0d537cebe97f087dc5fe5732d70719caaec1d': '/tokens/husdc.png',
}

function tokenLogo(address: string): string {
  return LOGO_OVERRIDES[address.toLowerCase()] || `https://tokens.app.pulsex.com/images/tokens/${toChecksumAddress(address)}.png`
}

async function fetchTotalSupply(address: string, decimals: number): Promise<number> {
  const resp = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: address, data: TOTAL_SUPPLY_SELECTOR }, 'latest'],
    }),
  })
  const data = await resp.json()
  if (!data.result || data.result === '0x') return 0
  const raw = BigInt(data.result)
  return Number(raw) / Math.pow(10, decimals)
}

export function useStablecoinSupply() {
  const [coins, setCoins] = useState<StablecoinData[]>([])
  const [totalMcap, setTotalMcap] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      // Fetch on-chain supply + cached metadata in parallel
      const addresses = STABLECOINS.map(s => s.address)

      const [supplies, pricesResult] = await Promise.all([
        Promise.all(STABLECOINS.map(s => fetchTotalSupply(s.address, s.decimals))),
        supabase
          .from('token_prices')
          .select('symbol, name, address, price_usd')
          .in('address', addresses),
      ])

      const priceMap = new Map(
        (pricesResult.data || []).map(p => [p.address, p])
      )

      const results: StablecoinData[] = STABLECOINS.map((sc, i) => {
        const supply = supplies[i]
        const meta = priceMap.get(sc.address)
        const price = meta?.price_usd || 1 // stablecoins ≈ $1 fallback
        return {
          symbol: meta?.symbol || sc.symbol,
          name: meta?.name || sc.name,
          address: sc.address,
          price,
          supply,
          marketCap: supply * price,
          logo: tokenLogo(sc.address),
        }
      })
        .filter(c => c.supply > 0)
        .sort((a, b) => b.marketCap - a.marketCap)

      setCoins(results)
      setTotalMcap(results.reduce((sum, c) => sum + c.marketCap, 0))
    } catch (e) {
      console.warn('Stablecoin data fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return { coins, totalMcap, loading, refetch: fetchData }
}
