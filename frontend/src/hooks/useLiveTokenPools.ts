import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { LivePool, LivePoolSummary } from '../types'

/**
 * Fetch live pool summary for a single token from token_live_summary view.
 * Returns aggregated stats (total liquidity, volume, buy/sell counts, DEX list).
 */
export function useLiveTokenSummary(tokenAddress: string | undefined) {
  const [data, setData] = useState<LivePoolSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!tokenAddress) return
    setLoading(true)
    try {
      const { data: rows, error: err } = await supabase
        .from('token_live_summary')
        .select('*')
        .eq('token_address', tokenAddress.toLowerCase())
        .limit(1)
      if (err) throw err
      setData(rows?.[0] ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [tokenAddress])

  useEffect(() => { refetch() }, [refetch])

  return { data, loading, error, refetch }
}

/**
 * Fetch live pools for a single token from token_pools_live_view.
 * Returns individual pool details sorted by liquidity descending.
 * Only returns legitimate pools by default.
 */
export function useLiveTokenPools(tokenAddress: string | undefined, options?: {
  includeSpam?: boolean
  limit?: number
}) {
  const [data, setData] = useState<LivePool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!tokenAddress) return
    setLoading(true)
    try {
      let query = supabase
        .from('token_pools_live_view')
        .select('*')
        .eq('token_address', tokenAddress.toLowerCase())
        .order('liquidity_usd', { ascending: false, nullsFirst: false })

      if (!options?.includeSpam) {
        query = query.eq('pool_is_legitimate', true)
      }
      if (options?.limit) {
        query = query.limit(options.limit)
      }

      const { data: rows, error: err } = await query
      if (err) throw err
      setData(rows ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [tokenAddress, options?.includeSpam, options?.limit])

  useEffect(() => { refetch() }, [refetch])

  return { data, loading, error, refetch }
}
