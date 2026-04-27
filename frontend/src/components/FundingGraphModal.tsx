import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Copy, Check, ExternalLink, GitBranch, ArrowUpRight, ArrowDownLeft, ArrowLeft, Clock, Network } from 'lucide-react'
import TransactionTraceModal from './TransactionTraceModal'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import SpriteText from 'three-spritetext'
// @ts-ignore — d3-force-3d has no type declarations
import { forceCollide } from 'd3-force-3d'
import { shortenAddress, formatTimeAgo } from '../lib/format'
import { useLivePlsPrice } from '../hooks/useLivePlsPrice'
import { supabase } from '../lib/supabase'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'
const SCAN_URL = 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#'

// ── Types ────────────────────────────────────────────────────

interface Funder {
  address: string
  total_pls: number
  tx_count: number
  is_contract: boolean
  label: string | null
  first_tx: string | null
  funders?: Funder[]
}

interface WhaleLink {
  address_from: string
  address_to: string
  link_type: string
  detail: string | null
}

interface BridgeInteraction {
  address: string
  total_pls: number
  tx_count: number
  is_contract: boolean
  label: string
  first_tx: string | null
  direction: 'outgoing' | 'incoming'
  wallet: string
  bridged_tokens?: string[]  // e.g. ["USDC", "DAI", "WETH"]
}

interface FundingTreeData {
  target: string
  target_name: string | null
  target_is_contract: boolean
  funders: Funder[]
  bridge_interactions: BridgeInteraction[]
  whale_links: WhaleLink[]
}

interface TokenTransfer {
  token_symbol: string
  token_name: string
  token_address: string
  amount: number
  from: string
  to: string
}

interface Transaction {
  hash: string
  from: string
  from_name: string | null
  to: string
  to_name: string | null
  value_pls: number
  token_transfers: TokenTransfer[]
  method: string | null
  timestamp: string | null
  block: number | null
}

interface GraphNode {
  id: string
  label: string
  color: string
  nodeType: string
  totalPls: number
  txCount: number
  firstTx: string | null
  isTarget: boolean
  val: number
}

interface GraphLink {
  source: string
  target: string
  color: string
  edgeKind: string
  curvature: number
}

// ── Constants ────────────────────────────────────────────────

const BG_SURFACE = '#0a0a10'

const NODE_COLORS: Record<string, string> = {
  Target: '#fbbf24',
  Wallet: '#a855f7',
  Contract: '#10b981',
  Bridge: '#3b82f6',
  DEX: '#f97316',      // orange for DEX/DeFi
  Burn: '#f59e0b',
  Validator: '#06b6d4',
}

const DEPOSIT_CONTRACT = '0x3693000000000000000000000000000000003693'
const KNOWN_CONTRACTS: Record<string, string> = {
  [DEPOSIT_CONTRACT]: 'Deposit Contract (Validator)',
}
const VALIDATOR_DEPOSIT = 32_000_000

const TOKEN_LOGOS: Record<string, string> = {
  PLS: '/tokens/pls.png',
  PLSX: '/tokens/plsx.png',
  HEX: '/tokens/phex.png',
  INC: '/tokens/inc.png',
  PRVX: '/tokens/prvx.png',
  HDRN: 'https://tokens.app.pulsex.com/images/tokens/0x3819f64f282bf135d62168C1e513280dAF905e06.png',
  WPLS: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png',
  DAI: 'https://tokens.app.pulsex.com/images/tokens/0x6B175474E89094C44Da98b954EedeAC495271d0F.png',
  USDC: 'https://tokens.app.pulsex.com/images/tokens/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48.png',
  USDT: 'https://tokens.app.pulsex.com/images/tokens/0xdAC17F958D2ee523a2206206994597C13D831ec7.png',
  WETH: 'https://tokens.app.pulsex.com/images/tokens/0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C.png',
  WBTC: 'https://tokens.app.pulsex.com/images/tokens/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599.png',
}

// Richard Heart ecosystem — filter by contract address (reliable, symbol can vary)
const RH_ADDR_TO_SYMBOL: Record<string, string> = {
  '0x0000000000000000000000000000000000000000': 'PLS',    // native PLS
  '0x95b303987a60c71504d99aa1b13b4da07b0790ab': 'PLSX',
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': 'HEX',
  '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d': 'INC',
  '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11': 'PRVX',
}

// Map display symbol → league API symbol (leagues use PLS, PLSX, HEX, INC)
const DISPLAY_TO_LEAGUE: Record<string, string> = {
  'PLS': 'PLS', 'PLSX': 'PLSX', 'HEX': 'HEX', 'INC': 'INC',
}

const TIER_EMOJI: Record<string, string> = {
  poseidon: '\u{1F531}', whale: '\u{1F40B}', shark: '\u{1F988}',
  dolphin: '\u{1F42C}', squid: '\u{1F991}', turtle: '\u{1F422}',
}
const TIER_COLOR: Record<string, string> = {
  poseidon: '#fbbf24', whale: '#3b82f6', shark: '#8b5cf6',
  dolphin: '#06b6d4', squid: '#10b981', turtle: '#6b7280',
}

interface TokenBalance {
  token_address: string
  symbol: string
  displaySymbol: string  // normalized display symbol (e.g. HEX, PLS)
  name: string
  balance: number
  token_type: string
}

// ── Glow texture cache for 3D nodes ─────────────────────────

const glowTextureCache = new Map<string, THREE.Texture>()
function getGlowTexture(color: string): THREE.Texture {
  if (glowTextureCache.has(color)) return glowTextureCache.get(color)!
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2)
  g.addColorStop(0, color)
  g.addColorStop(0.15, color + 'cc')
  g.addColorStop(0.4, color + '40')
  g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  glowTextureCache.set(color, tex)
  return tex
}

// ── Helpers ──────────────────────────────────────────────────

const DEX_LABELS = ['PulseX', 'Piteas', '9inch', '9mm', 'PHUX', 'Velocimeter', 'PulseSwap',
  'EazySwap', 'Internet Money', 'DexTop', 'SparkSwap', 'Algebra', 'Elk', 'FireBird', 'DEGEN']
const BRIDGE_LABELS = ['Bridge', 'Omni', 'Hyperlane']
const BURN_LABELS = ['Burn', 'Null', 'dead']
const DEFI_LABELS = ['LiquidLoans', 'Phiat', 'POWERCITY', 'Maximus', 'Hedron', 'Icosa',
  'Genius', 'PHAME', 'Vouch', 'DxSale', 'Team Finance', 'MasterChef', 'StabilityPool']

function nodeColor(f: { is_contract: boolean; label: string | null }): string {
  if (BRIDGE_LABELS.some(k => f.label?.includes(k))) return NODE_COLORS.Bridge
  if (DEX_LABELS.some(k => f.label?.includes(k))) return NODE_COLORS.DEX
  if (BURN_LABELS.some(k => f.label?.includes(k))) return NODE_COLORS.Burn
  if (DEFI_LABELS.some(k => f.label?.includes(k))) return NODE_COLORS.Contract
  if (f.label?.includes('Validator')) return NODE_COLORS.Validator
  if (f.is_contract) return NODE_COLORS.Contract
  return NODE_COLORS.Wallet
}

function nodeType(f: { is_contract: boolean; label: string | null }): string {
  if (BRIDGE_LABELS.some(k => f.label?.includes(k))) return 'Bridge'
  if (DEX_LABELS.some(k => f.label?.includes(k))) return 'DEX'
  if (BURN_LABELS.some(k => f.label?.includes(k))) return 'Burn'
  if (DEFI_LABELS.some(k => f.label?.includes(k))) return 'Contract'
  if (f.label?.includes('Validator')) return 'Validator'
  if (f.is_contract) return 'Contract'
  return 'Wallet'
}

function formatPls(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(0)
}

function formatUsd(value: number, plsPrice: number | null): string | null {
  if (!plsPrice) return null
  const usd = value * plsPrice
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(6)}`
}

// ── Link colors by direction ─────────────────────────────────

const LINK_COLOR_IN = 'rgba(16,185,129,0.6)'        // emerald — incoming
const LINK_COLOR_IN_SUB = 'rgba(16,185,129,0.35)'   // lighter green — sub-funder
const LINK_COLOR_OUT = 'rgba(239,68,68,0.6)'         // red — outgoing

// ── Build graph data from API ────────────────────────────────

function buildGraphData(
  data: FundingTreeData,
  allTxs: Transaction[] = [],
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const addedNodes = new Set<string>()

  const targetLower = data.target.toLowerCase()
  const targetLabel = KNOWN_CONTRACTS[targetLower] || data.target_name || shortenAddress(data.target)
  const targetType = KNOWN_CONTRACTS[targetLower]
    ? 'Validator'
    : data.target_is_contract ? 'Contract' : 'Target'

  nodes.push({
    id: data.target,
    label: targetLabel,
    color: NODE_COLORS[targetType] || NODE_COLORS.Target,
    nodeType: targetType,
    totalPls: 0,
    txCount: 0,
    firstTx: null,
    isTarget: true,
    val: 1,
    fx: 0,
    fy: 0,
  } as any)
  addedNodes.add(data.target)
  addedNodes.add(targetLower)

  // ── Incoming funders (GREEN) ──
  data.funders.forEach(f => {
    const addr = f.address.toLowerCase()
    if (addedNodes.has(addr)) return
    addedNodes.add(addr)

    nodes.push({
      id: addr,
      label: f.label || shortenAddress(addr),
      color: nodeColor(f),
      nodeType: nodeType(f),
      totalPls: f.total_pls,
      txCount: f.tx_count,
      firstTx: f.first_tx,
      isTarget: false,
      val: 1,
    })

    links.push({
      source: addr,
      target: data.target,
      color: LINK_COLOR_IN,
      edgeKind: 'incoming',
      curvature: 0.2,
    })

    if (f.funders) {
      f.funders.forEach(sf => {
        const sfAddr = sf.address.toLowerCase()
        if (addedNodes.has(sfAddr)) {
          links.push({
            source: sfAddr,
            target: addr,
            color: LINK_COLOR_IN_SUB,
            edgeKind: 'incoming',
            curvature: 0.15,
          })
          return
        }
        addedNodes.add(sfAddr)

        nodes.push({
          id: sfAddr,
          label: sf.label || shortenAddress(sfAddr),
          color: nodeColor(sf),
          nodeType: nodeType(sf),
          totalPls: sf.total_pls,
          txCount: sf.tx_count,
          firstTx: sf.first_tx,
          isTarget: false,
          val: 1,
        })

        links.push({
          source: sfAddr,
          target: addr,
          color: LINK_COLOR_IN_SUB,
          edgeKind: 'incoming',
          curvature: 0.15,
        })
      })
    }
  })

  // ── Outgoing transactions (RED) ──
  const outgoingTxs = allTxs.filter(tx => tx.from.toLowerCase() === targetLower && tx.value_pls > 0)
  for (const tx of outgoingTxs) {
    const recipientAddr = tx.to.toLowerCase()
    if (!addedNodes.has(recipientAddr)) {
      addedNodes.add(recipientAddr)
      nodes.push({
        id: recipientAddr,
        label: tx.to_name || shortenAddress(recipientAddr),
        color: NODE_COLORS.Wallet,
        nodeType: 'Wallet',
        totalPls: tx.value_pls,
        txCount: 1,
        firstTx: tx.timestamp,
        isTarget: false,
        val: 1,
      })
    }
    links.push({
      source: data.target,
      target: recipientAddr,
      color: LINK_COLOR_OUT,
      edgeKind: 'outgoing',
      curvature: 0.2,
    })
  }

  // ── Additional incoming from txs not already in funding tree (GREEN) ──
  const incomingTxs = allTxs.filter(tx => tx.to.toLowerCase() === targetLower && tx.value_pls > 0)
  for (const tx of incomingTxs) {
    const senderAddr = tx.from.toLowerCase()
    if (!addedNodes.has(senderAddr)) {
      addedNodes.add(senderAddr)
      nodes.push({
        id: senderAddr,
        label: tx.from_name || shortenAddress(senderAddr),
        color: NODE_COLORS.Wallet,
        nodeType: 'Wallet',
        totalPls: tx.value_pls,
        txCount: 1,
        firstTx: tx.timestamp,
        isTarget: false,
        val: 1,
      })
      links.push({
        source: senderAddr,
        target: data.target,
        color: LINK_COLOR_IN,
        edgeKind: 'incoming',
        curvature: 0.2,
      })
    }
  }

  // ── Bridge interactions (BLUE — connected to wallets/target) ──
  if (data.bridge_interactions) {
    for (const bi of data.bridge_interactions) {
      const biAddr = bi.address.toLowerCase()
      const walletAddr = (bi.wallet || data.target).toLowerCase()
      // Only add bridge if the connected wallet is in the graph
      if (!addedNodes.has(walletAddr)) continue
      if (!addedNodes.has(biAddr)) {
        addedNodes.add(biAddr)
        const biLabel = bi.bridged_tokens?.length
          ? `${bi.label}\n${bi.bridged_tokens.join(', ')}`
          : bi.label || 'Contract'
        const biType = nodeType({ is_contract: true, label: bi.label })
        const biColor = nodeColor({ is_contract: true, label: bi.label })
        nodes.push({
          id: biAddr,
          label: biLabel,
          color: biColor,
          nodeType: biType,
          totalPls: bi.total_pls,
          txCount: bi.tx_count,
          firstTx: bi.first_tx,
          isTarget: false,
          val: 1,
        })
      }
      // Direction: wallet→protocol (outgoing) or protocol→wallet (incoming)
      const [src, tgt] = bi.direction === 'incoming'
        ? [biAddr, walletAddr]
        : [walletAddr, biAddr]
      const exists = links.some(l => {
        const lSrc = typeof l.source === 'string' ? l.source : (l.source as any).id
        const lTgt = typeof l.target === 'string' ? l.target : (l.target as any).id
        return lSrc === src && lTgt === tgt
      })
      if (!exists) {
        links.push({
          source: src,
          target: tgt,
          color: bi.direction === 'incoming' ? LINK_COLOR_IN : LINK_COLOR_OUT,
          edgeKind: bi.direction === 'incoming' ? 'incoming' : 'outgoing',
          curvature: 0.25,
        })
      }
    }
  }

  // Whale links
  for (const link of data.whale_links) {
    const from = link.address_from.toLowerCase()
    const to = link.address_to.toLowerCase()
    if (addedNodes.has(from) && addedNodes.has(to)) {
      const exists = links.some(l =>
        (typeof l.source === 'string' ? l.source : (l.source as any).id) === from &&
        (typeof l.target === 'string' ? l.target : (l.target as any).id) === to
      )
      if (!exists) {
        links.push({
          source: from,
          target: to,
          color: 'rgba(168,85,247,0.5)',
          edgeKind: 'whale',
          curvature: 0.3,
        })
      }
    }
  }

  return { nodes, links }
}

// ── Copy button ──────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="p-0.5 text-gray-500 hover:text-white transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// ── Token logo ──────────────────────────────────────────────

function TokenIcon({ symbol, address, className = 'h-3.5 w-3.5' }: { symbol: string; address?: string; className?: string }) {
  if (!symbol) return null
  const logo = TOKEN_LOGOS[symbol]
  // Fallback: PulseX CDN by contract address, or colored circle with initial
  const pulsexFallback = address && address !== '0x0000000000000000000000000000000000000000'
    ? `https://tokens.app.pulsex.com/images/tokens/${address}.png`
    : undefined
  const src = logo || pulsexFallback
  if (!src) {
    // Colored circle with first letter
    const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
    const color = colors[symbol.charCodeAt(0) % colors.length]
    return (
      <span
        className={`${className} rounded-full inline-flex items-center justify-center text-[8px] font-bold text-white shrink-0`}
        style={{ background: color }}
      >
        {symbol.charAt(0)}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={symbol}
      className={`${className} rounded-full inline-block shrink-0`}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

// ── Detail panel (right side) ────────────────────────────────

function DetailPanel({
  address,
  nodeData,
  plsPrice,
  fetchedAt,
  onClose,
  onTraceHash,
}: {
  address: string
  nodeData: { nodeType: string; totalPls: number; txCount: number; firstTx: string | null; color: string; isTarget: boolean }
  plsPrice: number | null
  fetchedAt: Date | null
  onClose: () => void
  onTraceHash?: (hash: string) => void
}) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [balances, setBalances] = useState<(TokenBalance & { usdValue: number })[]>([])
  const [ranks, setRanks] = useState<Record<string, { rank: number; total_holders: number; tier: string; balance_pct: number }>>({})
  const [intelAlerts, setIntelAlerts] = useState<{ title: string; risk_level: string; summary: string; source_tweet?: string; source_author?: string }[]>([])
  const [safetyScores, setSafetyScores] = useState<Record<string, { grade: string; score: number; is_honeypot: boolean; risks: string[] }>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // Fetch ranks in parallel (non-blocking)
    fetch(`${SAFETY_API}/api/v1/leagues/rank/${address}`)
      .then(r => r.ok ? r.json() : { ranks: {} })
      .then(data => setRanks(data.ranks || {}))
      .catch(() => {})

    // Fetch Intel conclusions for this address (cross-reference)
    Promise.resolve(supabase.from('research_intel_conclusions')
      .select('title,risk_level,summary,evidence,addresses_involved')
      .or(`addresses_involved.cs.{${address.toLowerCase()}},addresses_involved.cs.{${address}}`))
      .then(async (res) => {
        if (!res.data || res.data.length === 0) return
        const alerts: typeof intelAlerts = []
        for (const c of res.data) {
          const alert: typeof intelAlerts[0] = {
            title: c.title,
            risk_level: c.risk_level,
            summary: c.summary,
          }
          // Fetch source tweet if evidence exists
          const evidence = Array.isArray(c.evidence) ? c.evidence : []
          if (evidence.length > 0 && evidence[0]?.tweet_id) {
            const tw = await supabase.from('research_tweets')
              .select('tweet_url,author_username')
              .eq('id', evidence[0].tweet_id)
              .single()
            if (tw.data) {
              alert.source_tweet = tw.data.tweet_url
              alert.source_author = tw.data.author_username
            }
          }
          alerts.push(alert)
        }
        setIntelAlerts(alerts)
      })
      .catch(() => {})

    Promise.all([
      fetch(`${SAFETY_API}/api/v1/address/${address}/transactions?limit=20`)
        .then(r => r.ok ? r.json() : { transactions: [] }).catch(() => ({ transactions: [] })),
      fetch(`${SAFETY_API}/api/v1/wallet/${address}/balances`)
        .then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
      supabase.from('token_prices').select('id,symbol,price_usd,address').then(res => res.data || []),
    ]).then(([txJson, balJson, prices]) => {
      const all = txJson.transactions || []
      setTxs(all.filter((tx: Transaction) => tx.value_pls > 0 || (tx.token_transfers && tx.token_transfers.length > 0)))

      const rawBals = (balJson.data || []) as { token_address: string; symbol: string; name: string; balance: number; token_type: string }[]
      const priceRows = (prices || []) as { id: string; symbol: string; price_usd: number | null; address: string | null }[]

      // ── Build price map: address → price_usd ──
      // token_prices stores contract address in BOTH `id` and `address` columns
      // (address can be null) — must check both, same as LeaguesPage
      const addrPriceMap = new Map<string, number>()
      for (const p of priceRows) {
        if (!p.price_usd) continue
        if (p.address) addrPriceMap.set(p.address.toLowerCase(), p.price_usd)
        if (p.id) addrPriceMap.set(p.id.toLowerCase(), p.price_usd)
      }
      // PLS live price (most accurate)
      if (plsPrice) addrPriceMap.set('0x0000000000000000000000000000000000000000', plsPrice)
      // Stablecoins = always $1.00 (override DEX price which can be wrong for bridged tokens)
      const stableAddrs = [
        '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07', // USDC (bridged from ETH)
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (native ETH address on PulseChain)
        '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
        '0xefd766ccb38eaf1dfd701853bfce31359239f305', // DAI from ETH
        '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      ]
      for (const addr of stableAddrs) {
        addrPriceMap.set(addr, 1.0)
      }

      // ── Map ALL tokens with balance > 0, compute USD ──
      // Keep tokens with USD value > $0.01 OR known tokens without price
      const SCAM_PATTERNS = /claim|free\.|bonus|reward|\.site|\.page|\.xyz/i
      const mapped: (TokenBalance & { usdValue: number })[] = rawBals
        .filter(b => b.balance > 0)
        .filter(b => !SCAM_PATTERNS.test(b.symbol) && !SCAM_PATTERNS.test(b.name))
        .map(b => {
          const addr = b.token_address.toLowerCase()
          const displaySymbol = RH_ADDR_TO_SYMBOL[addr] || b.symbol
          const price = addrPriceMap.get(addr) || 0
          return { ...b, displaySymbol, usdValue: b.balance * price }
        })
        .sort((a, b) => b.usdValue - a.usdValue)
        .slice(0, 20)

      setBalances(mapped)

      // Fetch safety scores for token addresses in holdings
      const tokenAddrs = mapped.map(m => m.token_address).filter(a => a !== '0x0000000000000000000000000000000000000000')
      if (tokenAddrs.length > 0) {
        supabase.from('token_safety_scores')
          .select('token_address,grade,score,is_honeypot,risks')
          .in('token_address', tokenAddrs)
          .then(res => {
            const map: typeof safetyScores = {}
            for (const row of (res.data || [])) {
              map[row.token_address.toLowerCase()] = {
                grade: row.grade,
                score: row.score,
                is_honeypot: row.is_honeypot,
                risks: row.risks || [],
              }
            }
            setSafetyScores(map)
          })
      }
    }).finally(() => setLoading(false))
  }, [address, plsPrice])

  // holdingsWithUsd = balances already computed with USD
  const holdingsWithUsd = balances as (TokenBalance & { usdValue: number })[]

  const totalPortfolioUsd = useMemo(() =>
    holdingsWithUsd.reduce((sum, h) => sum + h.usdValue, 0)
  , [holdingsWithUsd])

  return (
    <div className="w-96 border-l border-white/10 flex flex-col overflow-hidden shrink-0" style={{ background: BG_SURFACE }}>
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: nodeData.color, boxShadow: `0 0 8px ${nodeData.color}60` }} />
          <span className="text-sm font-medium px-2 py-0.5 rounded" style={{ color: nodeData.color, background: `${nodeData.color}20` }}>
            {nodeData.nodeType}
          </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors">
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-white/5">
        {KNOWN_CONTRACTS[address.toLowerCase()] && (
          <div className="text-sm font-medium text-cyan-400 mb-1">{KNOWN_CONTRACTS[address.toLowerCase()]}</div>
        )}
        <div className="font-mono text-[11px] text-white break-all">{address}</div>
        <div className="flex items-center gap-2 mt-2">
          <CopyBtn text={address} />
          <a href={`${SCAN_URL}/address/${address}`} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-[#00D4FF] transition-colors">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Intel alerts — flagged addresses */}
      {intelAlerts.length > 0 && (
        <div className="px-4 py-2 border-b border-red-500/20 bg-red-500/5">
          {intelAlerts.map((alert, i) => {
            const riskColors: Record<string, string> = {
              critical: 'bg-red-600 text-white',
              high: 'bg-orange-500 text-white',
              medium: 'bg-yellow-500 text-black',
              low: 'bg-green-500 text-white',
            }
            return (
              <div key={i} className={i > 0 ? 'mt-2 pt-2 border-t border-red-500/10' : ''}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${riskColors[alert.risk_level] || riskColors.medium}`}>
                    {alert.risk_level}
                  </span>
                  <span className="text-xs font-medium text-red-300 line-clamp-1">{alert.title}</span>
                </div>
                <p className="text-[11px] text-gray-400 line-clamp-2">{alert.summary}</p>
                {alert.source_tweet && (
                  <a
                    href={alert.source_tweet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#00D4FF]/70 hover:text-[#00D4FF] mt-1 inline-flex items-center gap-1"
                  >
                    Source: {alert.source_author || 'tweet'} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            )
          })}
          {/* Divergence detection: Intel flags but Safety says safe */}
          {Object.values(safetyScores).length > 0 && (() => {
            const allSafe = Object.values(safetyScores).every(s => s.grade === 'A' || s.grade === 'B')
            if (allSafe) return (
              <div className="mt-2 pt-2 border-t border-yellow-500/20">
                <span className="text-[10px] text-yellow-400">⚠ Divergence : Intel flag cette adresse mais tous les tokens ont un grade Safety élevé (A/B). Possible faux positif — vérification manuelle recommandée.</span>
              </div>
            )
            return null
          })()}
        </div>
      )}

      <div className="px-4 py-3 border-b border-white/5 grid grid-cols-2 gap-3">
        {!nodeData.isTarget && (
          <>
            <div>
              <div className="text-[11px] text-gray-500 uppercase">Sent to target</div>
              <div className="text-base font-bold text-white flex items-center gap-1">
                <TokenIcon symbol="PLS" className="h-4 w-4" />
                {formatPls(nodeData.totalPls)} PLS
              </div>
              {formatUsd(nodeData.totalPls, plsPrice) && (
                <div className="text-xs text-emerald-400">{formatUsd(nodeData.totalPls, plsPrice)}</div>
              )}
            </div>
            <div>
              <div className="text-[11px] text-gray-500 uppercase">Tx Count</div>
              <div className="text-base font-bold text-white">{nodeData.txCount}</div>
            </div>
          </>
        )}
        {nodeData.firstTx && (
          <div className="col-span-2">
            <div className="text-[11px] text-gray-500 uppercase">First Tx</div>
            <div className="text-sm text-gray-300">{new Date(nodeData.firstTx).toLocaleDateString()}</div>
          </div>
        )}
        {fetchedAt && (
          <div className="col-span-2 flex items-center gap-1.5 pt-1 border-t border-white/5">
            <Clock className="h-3.5 w-3.5 text-gray-600" />
            <span className="text-[11px] text-gray-500">
              Data as of {fetchedAt.toLocaleTimeString()} · {fetchedAt.toLocaleDateString()}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">

      {/* Token holdings — full portfolio */}
      {holdingsWithUsd.length > 0 && (
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-gray-500 uppercase tracking-wider">Holdings</div>
            {totalPortfolioUsd > 0 && (
              <span className="text-base font-bold text-white">
                ${totalPortfolioUsd >= 1e6 ? `${(totalPortfolioUsd / 1e6).toFixed(2)}M`
                  : totalPortfolioUsd >= 1e3 ? `${(totalPortfolioUsd / 1e3).toFixed(2)}K`
                  : totalPortfolioUsd.toFixed(2)}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {holdingsWithUsd.map(h => {
              const pct = totalPortfolioUsd > 0 ? (h.usdValue / totalPortfolioUsd) * 100 : 0
              const leagueSym = DISPLAY_TO_LEAGUE[h.displaySymbol]
              const rankInfo = leagueSym ? ranks[leagueSym] : undefined
              const safety = safetyScores[h.token_address.toLowerCase()]
              const gradeColors: Record<string, string> = {
                A: 'text-emerald-400 bg-emerald-500/15',
                B: 'text-blue-400 bg-blue-500/15',
                C: 'text-yellow-400 bg-yellow-500/15',
                D: 'text-orange-400 bg-orange-500/15',
                F: 'text-red-400 bg-red-500/15',
              }
              return (
                <div key={h.displaySymbol}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={h.displaySymbol} address={h.token_address} className="h-5 w-5" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-white">{h.displaySymbol}</span>
                          {safety && (
                            <span
                              className={`text-[9px] font-bold px-1 py-0.5 rounded ${gradeColors[safety.grade] || gradeColors.C}`}
                              title={`Safety: ${safety.score}/100${safety.is_honeypot ? ' ⚠ HONEYPOT' : ''}${safety.risks.length > 0 ? '\nRisks: ' + safety.risks.join(', ') : ''}`}
                            >
                              {safety.is_honeypot ? '⚠ HP' : safety.grade}
                            </span>
                          )}
                        </div>
                        {rankInfo && (
                          <div
                            className="text-[10px] font-semibold px-1 py-0.5 rounded mt-0.5 inline-block ml-1"
                            style={{ color: TIER_COLOR[rankInfo.tier] || '#6b7280', backgroundColor: `${TIER_COLOR[rankInfo.tier] || '#6b7280'}20` }}
                            title={`${rankInfo.tier} — ${rankInfo.balance_pct.toFixed(4)}% of supply`}
                          >
                            {TIER_EMOJI[rankInfo.tier] || ''} #{rankInfo.rank.toLocaleString('en-US')}/{rankInfo.total_holders.toLocaleString('en-US')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm text-gray-300 font-mono">{formatPls(h.balance)}</span>
                      {h.usdValue > 0 && (
                        <div className="text-xs text-emerald-400/70">
                          ${h.usdValue >= 1e6 ? `${(h.usdValue / 1e6).toFixed(2)}M`
                            : h.usdValue >= 1e3 ? `${(h.usdValue / 1e3).toFixed(2)}K`
                            : h.usdValue.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Percentage bar */}
                  {totalPortfolioUsd > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500/50" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-500 w-10 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

        <div className="px-4 py-2 text-[11px] text-gray-500 uppercase tracking-wider sticky top-0 z-10" style={{ background: BG_SURFACE }}>
          Recent Transactions
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
          </div>
        ) : txs.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-600 text-center">No transactions found</div>
        ) : (
          <div className="space-y-1 px-2 pb-3">
            {txs.map((tx, i) => {
              const isIncoming = tx.to.toLowerCase() === address.toLowerCase()
              const isValidatorDeposit = Math.abs(tx.value_pls - VALIDATOR_DEPOSIT) < 1000
                && (tx.to.toLowerCase() === DEPOSIT_CONTRACT || address.toLowerCase() === DEPOSIT_CONTRACT)
              const hasTokenTransfers = tx.token_transfers && tx.token_transfers.length > 0
              return (
                <div key={tx.hash || i} className="rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-colors">
                  {isValidatorDeposit && (
                    <div className="text-[10px] text-cyan-400 font-medium mb-1">Validator Deposit</div>
                  )}
                  {tx.method && tx.method !== 'transfer' && (
                    <div className="text-[10px] text-purple-400/70 font-mono mb-1">{tx.method}</div>
                  )}
                  <div className="flex items-center gap-2">
                    {isIncoming
                      ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      : <ArrowUpRight className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    }
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-gray-300">
                        {isIncoming
                          ? (tx.from_name || KNOWN_CONTRACTS[tx.from.toLowerCase()] || shortenAddress(tx.from))
                          : (tx.to_name || KNOWN_CONTRACTS[tx.to.toLowerCase()] || shortenAddress(tx.to))
                        }
                      </span>
                      {tx.hash && (
                        <div className="font-mono text-[9px] text-gray-600 flex items-center gap-1">
                          tx {tx.hash.slice(0, 10)}…
                          {onTraceHash && (
                            <button
                              onClick={() => onTraceHash(tx.hash)}
                              className="text-purple-400/60 hover:text-purple-300 transition-colors"
                              title="View transaction trace"
                            >
                              <Network className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="ml-auto text-right shrink-0">
                      {/* PLS value if any */}
                      {tx.value_pls > 0 && (
                        <>
                          <span className="text-xs font-bold text-white flex items-center gap-1 justify-end">
                            <TokenIcon symbol="PLS" />
                            {formatPls(tx.value_pls)} PLS
                          </span>
                          {formatUsd(tx.value_pls, plsPrice) && (
                            <div className="text-[10px] text-emerald-400/70">{formatUsd(tx.value_pls, plsPrice)}</div>
                          )}
                        </>
                      )}
                      {/* Token transfers */}
                      {hasTokenTransfers && tx.token_transfers.slice(0, 3).map((tt, j) => {
                        const sym = RH_ADDR_TO_SYMBOL[tt.token_address] || tt.token_symbol
                        return (
                          <div key={j} className="flex items-center gap-1 justify-end mt-0.5">
                            <TokenIcon symbol={sym} />
                            <span className="text-xs font-bold text-white">
                              {tt.amount >= 1e6 ? `${(tt.amount / 1e6).toFixed(1)}M`
                                : tt.amount >= 1e3 ? `${(tt.amount / 1e3).toFixed(1)}K`
                                : tt.amount >= 1 ? tt.amount.toFixed(2)
                                : tt.amount.toFixed(6)} {sym}
                            </span>
                          </div>
                        )
                      })}
                      {hasTokenTransfers && tx.token_transfers.length > 3 && (
                        <div className="text-[10px] text-gray-500 mt-0.5">+{tx.token_transfers.length - 3} more</div>
                      )}
                    </div>
                  </div>
                  {tx.timestamp && (
                    <div className="text-[10px] text-gray-600 ml-5 mt-0.5">
                      {new Date(tx.timestamp).toLocaleString('en-US')} · {formatTimeAgo(tx.timestamp)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>{/* end flex-1 overflow-y-auto */}
    </div>
  )
}

// ── Embeddable content (react-force-graph-2d) ────────────────

export function FundingGraphContent({
  address,
  onClose,
  onBack,
}: {
  address: string
  tokenSymbol?: string  // kept for API compat, unused internally
  onClose: () => void
  onBack?: () => void
}) {
  const [data, setData] = useState<FundingTreeData | null>(null)
  const [allTxs, setAllTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedNodeData, setSelectedNodeData] = useState<Record<string, unknown> | null>(null)
  const [traceHash, setTraceHash] = useState<string | null>(null)
  const { price: plsPrice } = useLivePlsPrice()


  const fgRef = useRef<any>(null)
  const [graphSize, setGraphSize] = useState<{ w: number; h: number } | null>(null)

  // Callback ref — attaches ResizeObserver when the DOM element appears
  const roRef = useRef<ResizeObserver | null>(null)
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    // Cleanup previous observer
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setGraphSize({ w: Math.floor(width), h: Math.floor(height) })
        }
      }
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  // Fetch funding tree + all transactions in parallel
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const treeUrl = `${SAFETY_API}/api/v1/address/${address}/funding-tree?_t=${Date.now()}`
    const txUrl = `${SAFETY_API}/api/v1/address/${address}/transactions?limit=50&filter=all`

    Promise.all([
      fetch(treeUrl, { cache: 'no-store', signal: controller.signal }).then(r => r.ok ? r.json() : null),
      fetch(txUrl, { signal: controller.signal }).then(r => r.ok ? r.json() : null),
    ])
      .then(([treeJson, txJson]) => {
        if (treeJson && Array.isArray(treeJson.funders)) {
          setData(treeJson)
        } else {
          setData({ target: address, target_name: null, target_is_contract: false, funders: [], bridge_interactions: [], whale_links: [] })
        }
        if (txJson && Array.isArray(txJson.transactions)) {
          setAllTxs(txJson.transactions.filter((tx: Transaction) => tx.value_pls > 0))
        }
        setFetchedAt(new Date())
      })
      .catch(e => {
        if (e.name === 'AbortError') return
        setError(e.message || 'Failed to load')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [address])

  // Build full graph data (incoming + outgoing)
  const fullGraphData = useMemo(() => {
    if (!data || (data.funders.length === 0 && allTxs.length === 0)) return null
    return buildGraphData(data, allTxs)
  }, [data, allTxs])

  const displayData = fullGraphData

  // Configure d3 forces: gentle collision to prevent overlap, keep nodes compact
  useEffect(() => {
    if (!displayData) return
    const t = setTimeout(() => {
      const fg = fgRef.current
      if (!fg) return
      // Keep default charge (-30) — do NOT increase repulsion
      // Compact link distance (default ~30, keep it tight)
      fg.d3Force('link')?.distance(40)
      // Collision force: just enough to prevent sphere overlap (sphere R=6)
      fg.d3Force('collision', forceCollide(14))
      fg.d3ReheatSimulation?.()
    }, 200)
    return () => clearTimeout(t)
  }, [displayData])

  // Single stable zoomToFit — only when graph data changes, NOT on node click
  useEffect(() => {
    if (!displayData || !fgRef.current) return
    const fit = () => fgRef.current?.zoomToFit(400, 40)
    const t = setTimeout(fit, 3000)
    return () => clearTimeout(t)
  }, [displayData])

  // Node click handler
  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node.id)
    setSelectedNodeData({
      nodeType: node.nodeType,
      totalPls: node.totalPls,
      txCount: node.txCount,
      firstTx: node.firstTx,
      color: node.color,
      isTarget: node.isTarget,
    })
  }, [])

  // Track Three.js node objects for selection highlighting
  const nodeObjectsRef = useRef(new Map<string, THREE.Group>())

  // Custom 3D node rendering — Arkham-style glow sphere (all spheres SAME size)
  const createNodeThreeObject = useCallback((node: any) => {
    const color = node.color || '#a855f7'
    const group = new THREE.Group()

    // Main sphere with emissive glow
    const R = 6
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(R, 20, 15),
      new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.4,
        shininess: 80,
        transparent: true,
        opacity: 0.9,
      })
    )
    group.add(sphere)

    // Glow halo sprite
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: node.isTarget ? 0.7 : 0.45,
    }))
    const haloSize = node.isTarget ? 32 : 20
    halo.scale.set(haloSize, haloSize, 1)
    group.add(halo)

    // Label below sphere
    const label = new SpriteText(node.label || '', 2.5, node.isTarget ? '#fbbf24' : '#c4c4d4') as any
    label.fontFace = 'ui-monospace, monospace'
    label.fontWeight = '500'
    label.position.set(0, -(R + 4), 0)
    label.material.depthWrite = false
    group.add(label as THREE.Object3D)

    // Target node always renders on top (never hidden behind other nodes)
    if (node.isTarget) {
      group.renderOrder = 999
      sphere.renderOrder = 999
      ;(sphere.material as THREE.MeshPhongMaterial).depthTest = false
      halo.renderOrder = 998
      ;(halo.material as THREE.SpriteMaterial).depthTest = false
      label.renderOrder = 1000
      label.material.depthTest = false
    }


    nodeObjectsRef.current.set(node.id, group)
    return group
  }, [])

  // Selection highlight — update Three.js materials when selectedNode changes
  useEffect(() => {
    nodeObjectsRef.current.forEach((group, id) => {
      const isSelected = id === selectedNode
      const sphere = group.children[0] as THREE.Mesh
      const mat = sphere.material as THREE.MeshPhongMaterial
      const halo = group.children[1] as THREE.Sprite

      if (isSelected) {
        mat.emissiveIntensity = 1.0
        halo.scale.setScalar(36)
      } else {
        mat.emissiveIntensity = 0.4
        const isTarget = (group.children[2] as SpriteText)?.color === '#fbbf24'
        halo.scale.setScalar(isTarget ? 32 : 20)
      }
    })
  }, [selectedNode])

  // Cube particle factory — per-link colored cubes (blockchain blocks)
  const createParticleCube = useCallback((link: any) => {
    const isOutgoing = link.edgeKind === 'outgoing'
    const color = isOutgoing ? '#f87171' : '#34d399'
    const size = 1.2
    return new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.85,
      })
    )
  }, [])

  const hasData = data && (data.funders.length > 0 || allTxs.length > 0)

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors mr-1">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <GitBranch className="h-5 w-5 text-purple-400" />
          <h2 className="text-base font-bold text-white">Transaction Flow Map</h2>
          <span className="font-mono text-xs text-[#06b6d4]">{shortenAddress(address)}</span>
          <CopyBtn text={address} />
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden" style={{ minHeight: '500px' }}>
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-purple-400 mb-3" />
            <p className="text-sm text-gray-500">Mapping transaction flow history on-chain...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : !hasData ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-500">No transactions found for this address.</p>
          </div>
        ) : (
          <>
            {/* Graph panel */}
            <div ref={containerRef} className="flex-1 overflow-hidden" style={{ background: '#0a0a14', position: 'relative', minWidth: 0, minHeight: 0 }}>
              {displayData && graphSize && graphSize.w > 0 && graphSize.h > 0 && (
                <ForceGraph3D
                  ref={fgRef}
                  width={graphSize.w}
                  height={graphSize.h}
                  graphData={displayData}
                  nodeId="id"
                  nodeLabel=""
                  numDimensions={2}
                  nodeThreeObject={createNodeThreeObject}
                  onNodeClick={handleNodeClick}
                  onBackgroundClick={() => { setSelectedNode(null); setSelectedNodeData(null) }}
                  linkColor={(link: any) => link.color || 'rgba(99,102,241,0.5)'}
                  linkWidth={1}
                  linkCurvature={(link: any) => link.curvature || 0.2}
                  linkDirectionalArrowLength={0}
                  linkDirectionalParticles={3}
                  linkDirectionalParticleSpeed={0.005}
                  linkDirectionalParticleThreeObject={createParticleCube}
                  linkOpacity={0.6}
                  backgroundColor="#0a0a14"
                  cooldownTime={3000}
                  warmupTicks={50}
                  d3AlphaDecay={0.02}
                  d3VelocityDecay={0.3}
                  onEngineStop={() => {}}
                  enableNavigationControls={true}
                />
              )}


              {/* Legend overlay */}
              <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 z-10 rounded-lg px-3 py-2 border border-white/5" style={{ background: `${BG_SURFACE}b0` }}>
                {/* Flow direction */}
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-4 h-0.5 rounded" style={{ background: '#10b981' }} />
                  <span className="text-gray-400">Incoming</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-4 h-0.5 rounded" style={{ background: '#ef4444' }} />
                  <span className="text-gray-400">Outgoing</span>
                </div>
                <div className="w-px h-3 bg-white/10" />
                {/* Node types */}
                {Object.entries(NODE_COLORS).map(([label, color]) => (
                  <div key={label} className="flex items-center gap-1.5 text-[10px]">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}50` }} />
                    <span className="text-gray-500">{label}</span>
                  </div>
                ))}
              </div>

              {/* Click hint */}
              {!selectedNode && (
                <div className="absolute top-3 left-3 z-10 text-[10px] text-gray-600 rounded px-2 py-1 border border-white/5" style={{ background: `${BG_SURFACE}90` }}>
                  Click a node to inspect
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selectedNode && selectedNodeData && (
              <DetailPanel
                address={selectedNode}
                nodeData={selectedNodeData as { nodeType: string; totalPls: number; txCount: number; firstTx: string | null; color: string; isTarget: boolean }}
                plsPrice={plsPrice}
                fetchedAt={fetchedAt}
                onClose={() => { setSelectedNode(null); setSelectedNodeData(null) }}
                onTraceHash={(hash) => setTraceHash(hash)}
              />
            )}
          </>
        )}
      </div>

      {traceHash && (
        <TransactionTraceModal txHash={traceHash} onClose={() => setTraceHash(null)} />
      )}
    </>
  )
}

// ── Standalone modal (portal wrapper) ───────────────────────

export function FundingGraphModal({
  address,
  tokenSymbol,
  onClose,
}: {
  address: string
  tierLabel?: string
  tokenSymbol?: string
  onClose: () => void
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="relative border border-white/10 rounded-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          maxWidth: '90rem',
          background: '#1c1b22',
          boxShadow: '0 0 60px rgba(124,58,237,0.08), 0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        <FundingGraphContent address={address} tokenSymbol={tokenSymbol} onClose={onClose} />
      </div>
    </div>,
    document.body
  )
}
