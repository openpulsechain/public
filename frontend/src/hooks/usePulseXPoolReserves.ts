/**
 * Hook to fetch live PulseX pool reserves for Heart Law simulation.
 *
 * Fetches directly from PulseX V1+V2 subgraphs (on-chain data).
 * Combines reserves from both versions for accurate pool depth.
 */
import { useState, useEffect, useCallback } from 'react'
import type { PoolState, TokenPrices } from '../lib/heartLawEngine'

// ─── Subgraph endpoints ───
const PULSEX_V1 = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex'
const PULSEX_V2 = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2'

// ─── Token addresses (lowercase) ───
const WPLS   = '0xa1077a294dde1b09bb078844df40758a5d0f9a27'
const HEX_A  = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39'
const PLSX_A = '0x95b303987a60c71504d99aa1b13b4da07b0790ab'
const INC_A  = '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d'
const DAI_A  = '0xefd766ccb38eaf1dfd701853bfce31359239f305'
const USDC_A = '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07'
const USDT_A = '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f'
const STABLES = new Set([DAI_A, USDC_A, USDT_A])

// ─── V1 pair addresses ───
const V1_PAIRS = [
  '0xe56043671df55de5cdf8459710433c10324de0ae', // WPLS/DAI
  '0x6753560538eca67617a9ce605178f788be7e524e', // USDC/WPLS
  '0x322df7921f28f1146cdf62afdac0d6bc0ab80711', // USDT/WPLS
  '0xf1f4ee610b2babb05c635f726ef8b0c568c8dc65', // HEX/WPLS
  '0x1b45b9148791d3a104184cd5dfe5ce57193a3ee9', // PLSX/WPLS
  '0xf808bb6265e9ca27002c0a04562bf50d4fe37eaa', // INC/WPLS
  '0x7dbeca4c74d01cd8782d4ef5c05c0769723fb0ea', // INC/PLSX
]

// ─── V2 pair addresses ───
const V2_PAIRS = [
  '0x146e1f1e060e5b5016db0d118d2c5a11a240ae32', // WPLS/DAI
  '0x8ebe62d5e9d26b637673d91f56900233d6a4910d', // USDC/WPLS
  '0x21e4d9dfb30b097316de38ea49c68776c9735329', // USDT/WPLS
  '0x19bb45a7270177e303dee6eaa6f5ad700812ba98', // HEX/WPLS
  '0x149b2c629e652f2e89e11cd57e5d4d77ee166f9f', // PLSX/WPLS
  '0x5b9661276708202dd1a0dd2346a3856b00d3c251', // INC/WPLS
  '0xd41e6f7bb349085ac65107bfb3fadd49f1cfde1f', // INC/PLSX
]

// ─── Fallback pool data (used if both subgraphs fail) ───
const FALLBACK_POOLS: PoolState = {
  plsStables: { pls: 183_000_000_000, usd: 1_580_000 },
  plsHex:     { pls: 58_000_000_000, hex: 341_000_000 },
  plsPlsx:    { pls: 140_000_000_000, plsx: 188_500_000_000 },
  plsInc:     { pls: 54_000_000_000, inc: 1_249_000 },
  plsxInc:    { plsx: 104_300_000_000, inc: 1_793_000 },
}

interface PoolReservesResult {
  pools: PoolState | null
  prices: TokenPrices | null
  totalReserveUsd: number
  loading: boolean
  error: string | null
  refetch: () => void
}

function buildQuery(ids: string[]) {
  return `{ pairs(where: { id_in: [${ids.map(id => `"${id}"`).join(',')}] }) { id token0 { id } token1 { id } reserve0 reserve1 reserveUSD } }`
}

async function fetchSubgraph(url: string, ids: string[]): Promise<Array<{
  id: string; token0: { id: string }; token1: { id: string }
  reserve0: string; reserve1: string; reserveUSD: string
}>> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: buildQuery(ids) }),
  })
  if (!resp.ok) throw new Error(`Subgraph ${resp.status}`)
  const data = await resp.json()
  return data.data?.pairs || []
}

function parsePairsToPoolState(pairs: Array<{
  token0: { id: string }; token1: { id: string }
  reserve0: string; reserve1: string; reserveUSD: string
}>): { pools: PoolState; totalUsd: number } {
  const pools: PoolState = {
    plsStables: { pls: 0, usd: 0 },
    plsHex: { pls: 0, hex: 0 },
    plsPlsx: { pls: 0, plsx: 0 },
    plsInc: { pls: 0, inc: 0 },
    plsxInc: { plsx: 0, inc: 0 },
  }
  let totalUsd = 0

  for (const p of pairs) {
    const t0 = p.token0.id, t1 = p.token1.id
    const r0 = parseFloat(p.reserve0), r1 = parseFloat(p.reserve1)
    totalUsd += parseFloat(p.reserveUSD) || 0

    const has = (a: string, b: string) => (t0 === a && t1 === b) || (t0 === b && t1 === a)
    const get = (addr: string) => t0 === addr ? r0 : r1

    // PLS/Stablecoin pairs (DAI, USDC, USDT) → combined into plsStables
    const stableAddr = [t0, t1].find(addr => STABLES.has(addr))
    if (stableAddr && (t0 === WPLS || t1 === WPLS)) {
      pools.plsStables.pls += get(WPLS)
      pools.plsStables.usd += get(stableAddr)
    } else if (has(HEX_A, WPLS)) {
      pools.plsHex.hex += get(HEX_A)
      pools.plsHex.pls += get(WPLS)
    } else if (has(PLSX_A, WPLS)) {
      pools.plsPlsx.plsx += get(PLSX_A)
      pools.plsPlsx.pls += get(WPLS)
    } else if (has(INC_A, WPLS)) {
      pools.plsInc.inc += get(INC_A)
      pools.plsInc.pls += get(WPLS)
    } else if (has(INC_A, PLSX_A)) {
      pools.plsxInc.inc += get(INC_A)
      pools.plsxInc.plsx += get(PLSX_A)
    }
  }

  return { pools, totalUsd }
}

export function usePulseXPoolReserves(): PoolReservesResult {
  const [pools, setPools] = useState<PoolState | null>(null)
  const [prices, setPrices] = useState<TokenPrices | null>(null)
  const [totalReserveUsd, setTotalReserveUsd] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch V1 + V2 subgraphs in parallel
      const [v1Pairs, v2Pairs] = await Promise.all([
        fetchSubgraph(PULSEX_V1, V1_PAIRS).catch(() => []),
        fetchSubgraph(PULSEX_V2, V2_PAIRS).catch(() => []),
      ])

      const allPairs = [...v1Pairs, ...v2Pairs]
      if (allPairs.length === 0) throw new Error('No pool data from subgraphs')

      const { pools: poolState, totalUsd } = parsePairsToPoolState(allPairs)

      // Validate we got meaningful data
      if (poolState.plsStables.pls === 0 || poolState.plsStables.usd === 0) {
        throw new Error('Missing PLS/Stables pool data')
      }

      // Derive prices from pool reserves (same as heartLawEngine.derivePrices)
      const pricePLS = poolState.plsStables.usd / poolState.plsStables.pls
      const tokenPrices: TokenPrices = {
        PLS: pricePLS,
        HEX: poolState.plsHex.hex > 0
          ? (poolState.plsHex.pls / poolState.plsHex.hex) * pricePLS : 0,
        PLSX: poolState.plsPlsx.plsx > 0
          ? (poolState.plsPlsx.pls / poolState.plsPlsx.plsx) * pricePLS : 0,
        INC: poolState.plsxInc.inc > 0
          ? (poolState.plsxInc.plsx / poolState.plsxInc.inc) *
            (poolState.plsPlsx.plsx > 0 ? (poolState.plsPlsx.pls / poolState.plsPlsx.plsx) * pricePLS : 0)
          : 0,
      }

      setPools(poolState)
      setPrices(tokenPrices)
      setTotalReserveUsd(totalUsd)
    } catch (e) {
      console.warn('Subgraph fetch failed, using fallback:', e)
      setError('Using cached data — live data temporarily unavailable')
      setPools(FALLBACK_POOLS)
      const pricePLS = FALLBACK_POOLS.plsStables.usd / FALLBACK_POOLS.plsStables.pls
      setPrices({
        PLS: pricePLS,
        HEX: (FALLBACK_POOLS.plsHex.pls / FALLBACK_POOLS.plsHex.hex) * pricePLS,
        PLSX: (FALLBACK_POOLS.plsPlsx.pls / FALLBACK_POOLS.plsPlsx.plsx) * pricePLS,
        INC: (FALLBACK_POOLS.plsxInc.plsx / FALLBACK_POOLS.plsxInc.inc) *
          ((FALLBACK_POOLS.plsPlsx.pls / FALLBACK_POOLS.plsPlsx.plsx) * pricePLS),
      })
      setTotalReserveUsd(5_800_000)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { pools, prices, totalReserveUsd, loading, error, refetch: fetchData }
}
