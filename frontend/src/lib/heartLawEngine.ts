/**
 * Heart Law Simulation Engine v2
 *
 * Implements the constant product AMM formula (x * y = k) to simulate
 * price impacts of capital injections across interconnected PulseX pools.
 *
 * Features:
 * - 0.29% PulseX V2 swap fee
 * - INC dual-route through PLS/INC and PLSX/INC pools
 * - Dynamic sell pressure (sigmoid increase as price rises)
 * - LP withdrawal simulation (impermanent loss flight)
 * - Cross-pool arbitrage rebalancing (PLSX/INC equilibrium)
 * - MEV/front-running tax
 * - Reality Score (credibility indicator)
 */

// ─── Types ───

export interface TokenPrices {
  PLS: number
  HEX: number
  PLSX: number
  INC: number
}

export interface PoolState {
  plsStables: { pls: number; usd: number }
  plsHex: { pls: number; hex: number }
  plsPlsx: { pls: number; plsx: number }
  plsInc: { pls: number; inc: number }
  plsxInc: { plsx: number; inc: number }
}

export interface SimulationInput {
  amounts: Record<string, number>
  sellPressure: Record<string, number>   // 0-100 base sell pressure per token
  liquidityReduction: number              // 0-100 percentage
  includeFees: boolean
  dynamicSellPressure: boolean            // auto-increase SP as price rises
  lpWithdrawal: boolean                   // simulate IL-based LP exit
  mevTax: boolean                         // add MEV front-running cost
}

export interface ChunkResult {
  chunkNumber: number
  token: string
  amountUsd: number
  prices: TokenPrices
  pricesNoReflexivity: TokenPrices
}

export interface SimulationResult {
  initialPrices: TokenPrices
  finalPrices: TokenPrices
  finalPricesNoReflexivity: TokenPrices
  multipliers: TokenPrices
  multipliersNoReflexivity: TokenPrices
  chunks: ChunkResult[]
  totalInjected: number
  effectiveInjected: number
  poolState: PoolState
  initialPoolState: PoolState
  realityScore: number              // 0-100
  lpWithdrawnPct: number            // how much LP was withdrawn
  totalMevCost: number              // total MEV tax paid
  dynamicSellPressureApplied: Record<string, number>  // effective SP per token
}

// ─── Constants ───

const PULSEX_FEE = 0.0029       // 0.29% PulseX V2 fee
const MEV_TAX = 0.003            // ~0.3% MEV front-running cost per large swap
const MAX_CHUNK_SIZE = 100_000   // $100K max per chunk (finer granularity)
const MIN_CHUNKS_PER_TOKEN = 20

// Dynamic sell pressure sigmoid parameters
const SP_SIGMOID_CENTER = 3      // multiplier where dynamic SP hits 50%
const SP_SIGMOID_STEEPNESS = 1.5 // how sharply SP increases

// LP withdrawal parameters
const IL_THRESHOLD = 0.05        // 5% IL before LPs start leaving
const LP_EXIT_RATE = 0.4         // 40% of LPs above threshold exit proportionally
const MAX_CUMULATIVE_LP_EXIT = 0.50  // Max 50% total LP withdrawal across all rounds

// ─── Core AMM Math ───

export function ammSwap(
  reserveIn: number,
  reserveOut: number,
  amountIn: number,
  fee: number = 0
): { amountOut: number; newReserveIn: number; newReserveOut: number; priceImpact: number } {
  const k = reserveIn * reserveOut
  const effectiveIn = amountIn * (1 - fee)
  const newReserveIn = reserveIn + effectiveIn
  const newReserveOut = k / newReserveIn
  const amountOut = reserveOut - newReserveOut

  const priceBefore = reserveOut / reserveIn
  const priceAfter = newReserveOut / newReserveIn
  const priceImpact = Math.abs(priceAfter - priceBefore) / priceBefore

  return {
    amountOut,
    newReserveIn: reserveIn + amountIn,
    newReserveOut: newReserveOut,
    priceImpact,
  }
}

// ─── Price Derivation ───

export function derivePrices(pools: PoolState): TokenPrices {
  const pricePLS = pools.plsStables.usd / pools.plsStables.pls

  const hexInPls = pools.plsHex.pls / pools.plsHex.hex
  const priceHEX = hexInPls * pricePLS

  const plsxInPls = pools.plsPlsx.pls / pools.plsPlsx.plsx
  const pricePLSX = plsxInPls * pricePLS

  // INC price from PLSX/INC pool (deepest liquidity, matches Pampi)
  const priceINC = (pools.plsxInc.plsx / pools.plsxInc.inc) * pricePLSX

  return { PLS: pricePLS, HEX: priceHEX, PLSX: pricePLSX, INC: priceINC }
}

// ─── Dynamic Sell Pressure ───

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Calculate effective sell pressure for a token based on current multiplier.
 * Uses sigmoid curve: as price rises, more holders take profit.
 */
function getDynamicSellPressure(
  baseSP: number,
  currentMultiplier: number,
  dynamicEnabled: boolean
): number {
  if (!dynamicEnabled) return baseSP / 100

  const base = baseSP / 100
  // Sigmoid increases from base to ~95% as multiplier grows
  const dynamicFactor = sigmoid((currentMultiplier - SP_SIGMOID_CENTER) / SP_SIGMOID_STEEPNESS)
  // Blend: base SP + dynamic component (up to 95% max)
  const maxSP = 0.95
  const effectiveSP = base + (maxSP - base) * dynamicFactor
  return Math.min(effectiveSP, maxSP)
}

// ─── LP Withdrawal (Impermanent Loss) ───

/**
 * Calculate impermanent loss for a price ratio change.
 * IL = 2 * sqrt(r) / (1 + r) - 1  where r = new_price / old_price
 */
function calculateIL(priceRatio: number): number {
  if (priceRatio <= 0) return 0
  const sqrtR = Math.sqrt(priceRatio)
  return 2 * sqrtR / (1 + priceRatio) - 1  // negative = loss
}

/**
 * Simulate LP withdrawal from pools based on impermanent loss.
 * LPs start exiting when IL exceeds threshold.
 */
function applyLPWithdrawal(
  pools: PoolState,
  initialPrices: TokenPrices,
  currentPrices: TokenPrices,
  cumulativeWithdrawn: number
): number {
  // Cap cumulative withdrawal to prevent runaway feedback loops
  const remainingBudget = MAX_CUMULATIVE_LP_EXIT - cumulativeWithdrawn
  if (remainingBudget <= 0.001) return 0

  let roundWithdrawnPct = 0

  // PLS/Stables: IL based on PLS price change
  const plsRatio = currentPrices.PLS / initialPrices.PLS
  const plsIL = Math.abs(calculateIL(plsRatio))
  if (plsIL > IL_THRESHOLD) {
    const withdrawFactor = Math.min((plsIL - IL_THRESHOLD) * LP_EXIT_RATE, 0.3, remainingBudget)
    pools.plsStables.pls *= (1 - withdrawFactor)
    pools.plsStables.usd *= (1 - withdrawFactor)
    roundWithdrawnPct = Math.max(roundWithdrawnPct, withdrawFactor)
  }

  // PLS/HEX: IL based on HEX/PLS ratio change
  const hexPlsRatio = (currentPrices.HEX / currentPrices.PLS) / (initialPrices.HEX / initialPrices.PLS)
  const hexIL = Math.abs(calculateIL(hexPlsRatio))
  if (hexIL > IL_THRESHOLD) {
    const withdrawFactor = Math.min((hexIL - IL_THRESHOLD) * LP_EXIT_RATE, 0.3, remainingBudget)
    pools.plsHex.pls *= (1 - withdrawFactor)
    pools.plsHex.hex *= (1 - withdrawFactor)
    roundWithdrawnPct = Math.max(roundWithdrawnPct, withdrawFactor)
  }

  // PLS/PLSX
  const plsxPlsRatio = (currentPrices.PLSX / currentPrices.PLS) / (initialPrices.PLSX / initialPrices.PLS)
  const plsxIL = Math.abs(calculateIL(plsxPlsRatio))
  if (plsxIL > IL_THRESHOLD) {
    const withdrawFactor = Math.min((plsxIL - IL_THRESHOLD) * LP_EXIT_RATE, 0.3, remainingBudget)
    pools.plsPlsx.pls *= (1 - withdrawFactor)
    pools.plsPlsx.plsx *= (1 - withdrawFactor)
    roundWithdrawnPct = Math.max(roundWithdrawnPct, withdrawFactor)
  }

  // PLS/INC
  const incPlsRatio = (currentPrices.INC / currentPrices.PLS) / (initialPrices.INC / initialPrices.PLS)
  const incIL = Math.abs(calculateIL(incPlsRatio))
  if (incIL > IL_THRESHOLD) {
    const withdrawFactor = Math.min((incIL - IL_THRESHOLD) * LP_EXIT_RATE, 0.3, remainingBudget)
    pools.plsInc.pls *= (1 - withdrawFactor)
    pools.plsInc.inc *= (1 - withdrawFactor)
    roundWithdrawnPct = Math.max(roundWithdrawnPct, withdrawFactor)
  }

  // PLSX/INC
  const incPlsxRatio = (currentPrices.INC / currentPrices.PLSX) / (initialPrices.INC / initialPrices.PLSX)
  const incPlsxIL = Math.abs(calculateIL(incPlsxRatio))
  if (incPlsxIL > IL_THRESHOLD) {
    const withdrawFactor = Math.min((incPlsxIL - IL_THRESHOLD) * LP_EXIT_RATE, 0.3, remainingBudget)
    pools.plsxInc.plsx *= (1 - withdrawFactor)
    pools.plsxInc.inc *= (1 - withdrawFactor)
    roundWithdrawnPct = Math.max(roundWithdrawnPct, withdrawFactor)
  }

  return roundWithdrawnPct * 100
}

// Note: Cross-pool arbitrage removed to match Pampi behavior
// (Pampi audit: "boucle circulaire sans coût d'arbitrage")

// ─── Reality Score ───

/**
 * Calculate a reality score 0-100 based on injection/liquidity ratio.
 * Higher ratio = less realistic scenario = lower score.
 */
export function calculateRealityScore(injectionUsd: number, totalLiquidityUsd: number): number {
  if (totalLiquidityUsd <= 0) return 0
  const ratio = injectionUsd / totalLiquidityUsd
  // Score drops with injection size relative to liquidity
  // ratio 0.05 → ~93, ratio 0.5 → ~50, ratio 2 → ~15, ratio 10 → ~3
  return Math.round(100 / (1 + Math.pow(ratio / 0.5, 1.5)))
}

// ─── Simulation Engine ───

function clonePools(pools: PoolState): PoolState {
  return {
    plsStables: { ...pools.plsStables },
    plsHex: { ...pools.plsHex },
    plsPlsx: { ...pools.plsPlsx },
    plsInc: { ...pools.plsInc },
    plsxInc: { ...pools.plsxInc },
  }
}

function simulateBuy(
  pools: PoolState,
  token: string,
  usdAmount: number,
  fee: number
): void {
  if (usdAmount <= 0) return

  if (token === 'PLS') {
    const result = ammSwap(pools.plsStables.usd, pools.plsStables.pls, usdAmount, fee)
    pools.plsStables.usd = result.newReserveIn
    pools.plsStables.pls = result.newReserveOut
  } else if (token === 'HEX') {
    const hop1 = ammSwap(pools.plsStables.usd, pools.plsStables.pls, usdAmount, fee)
    pools.plsStables.usd = hop1.newReserveIn
    pools.plsStables.pls = hop1.newReserveOut
    const hop2 = ammSwap(pools.plsHex.pls, pools.plsHex.hex, hop1.amountOut, fee)
    pools.plsHex.pls = hop2.newReserveIn
    pools.plsHex.hex = hop2.newReserveOut
  } else if (token === 'PLSX') {
    const hop1 = ammSwap(pools.plsStables.usd, pools.plsStables.pls, usdAmount, fee)
    pools.plsStables.usd = hop1.newReserveIn
    pools.plsStables.pls = hop1.newReserveOut
    const hop2 = ammSwap(pools.plsPlsx.pls, pools.plsPlsx.plsx, hop1.amountOut, fee)
    pools.plsPlsx.pls = hop2.newReserveIn
    pools.plsPlsx.plsx = hop2.newReserveOut
  } else if (token === 'INC') {
    // Split across both INC pools proportional to INC reserves
    // Route A: USD -> PLS -> INC (via PLS/INC)
    // Route B: USD -> PLS -> PLSX -> INC (via PLSX/INC)
    const incPoolA = pools.plsInc.inc
    const incPoolB = pools.plsxInc.inc
    const totalInc = incPoolA + incPoolB
    const fracA = incPoolA / totalInc
    const fracB = 1 - fracA

    // Route A
    if (fracA > 0) {
      const hop1a = ammSwap(pools.plsStables.usd, pools.plsStables.pls, usdAmount * fracA, fee)
      pools.plsStables.usd = hop1a.newReserveIn
      pools.plsStables.pls = hop1a.newReserveOut
      const hop2a = ammSwap(pools.plsInc.pls, pools.plsInc.inc, hop1a.amountOut, fee)
      pools.plsInc.pls = hop2a.newReserveIn
      pools.plsInc.inc = hop2a.newReserveOut
    }

    // Route B
    if (fracB > 0) {
      const hop1b = ammSwap(pools.plsStables.usd, pools.plsStables.pls, usdAmount * fracB, fee)
      pools.plsStables.usd = hop1b.newReserveIn
      pools.plsStables.pls = hop1b.newReserveOut
      const hop2b = ammSwap(pools.plsPlsx.pls, pools.plsPlsx.plsx, hop1b.amountOut, fee)
      pools.plsPlsx.pls = hop2b.newReserveIn
      pools.plsPlsx.plsx = hop2b.newReserveOut
      const hop3b = ammSwap(pools.plsxInc.plsx, pools.plsxInc.inc, hop2b.amountOut, fee)
      pools.plsxInc.plsx = hop3b.newReserveIn
      pools.plsxInc.inc = hop3b.newReserveOut
    }
  }
}

function simulateBuyIsolated(
  pools: Record<string, { usd: number; token: number }>,
  token: string,
  usdAmount: number,
  fee: number
): void {
  if (usdAmount <= 0 || !pools[token]) return
  const pool = pools[token]
  const result = ammSwap(pool.usd, pool.token, usdAmount, fee)
  pool.usd = result.newReserveIn
  pool.token = result.newReserveOut
}

/**
 * Run the full Heart Law simulation with all realism features.
 */
export function runSimulation(
  initialPools: PoolState,
  input: SimulationInput,
  totalLiquidityUsd: number = 0
): SimulationResult {
  // Apply liquidity reduction
  const pools = clonePools(initialPools)
  if (input.liquidityReduction > 0) {
    const factor = 1 - input.liquidityReduction / 100
    pools.plsStables.pls *= factor
    pools.plsStables.usd *= factor
    pools.plsHex.pls *= factor
    pools.plsHex.hex *= factor
    pools.plsPlsx.pls *= factor
    pools.plsPlsx.plsx *= factor
    pools.plsInc.pls *= factor
    pools.plsInc.inc *= factor
    pools.plsxInc.plsx *= factor
    pools.plsxInc.inc *= factor
  }

  const baseFee = input.includeFees ? PULSEX_FEE : 0
  const mevFee = input.mevTax ? MEV_TAX : 0
  const fee = baseFee + mevFee

  const initialPrices = derivePrices(pools)
  const initialPoolState = clonePools(pools)

  // Build chunk schedule
  const activeTokens = Object.entries(input.amounts)
    .filter(([, amount]) => amount > 0)
    .map(([token]) => token)

  if (activeTokens.length === 0) {
    return {
      initialPrices,
      finalPrices: initialPrices,
      finalPricesNoReflexivity: initialPrices,
      multipliers: { PLS: 1, HEX: 1, PLSX: 1, INC: 1 },
      multipliersNoReflexivity: { PLS: 1, HEX: 1, PLSX: 1, INC: 1 },
      chunks: [],
      totalInjected: 0,
      effectiveInjected: 0,
      poolState: pools,
      initialPoolState,
      realityScore: 100,
      lpWithdrawnPct: 0,
      totalMevCost: 0,
      dynamicSellPressureApplied: {},
    }
  }

  const maxPerToken = Math.max(...Object.values(input.amounts))
  const chunksPerToken = Math.max(MIN_CHUNKS_PER_TOKEN, Math.ceil(maxPerToken / MAX_CHUNK_SIZE))

  // === Reflexive simulation ===
  const reflexivePools = clonePools(pools)
  const chunks: ChunkResult[] = []

  // === Non-reflexive simulation ===
  const isoInitialPrices = derivePrices(pools)
  const isolatedPools: Record<string, { usd: number; token: number }> = {
    PLS: { usd: pools.plsStables.usd, token: pools.plsStables.pls },
    HEX: { usd: isoInitialPrices.HEX * pools.plsHex.hex, token: pools.plsHex.hex },
    PLSX: {
      usd: isoInitialPrices.PLSX * (pools.plsPlsx.plsx + pools.plsxInc.plsx),
      token: pools.plsPlsx.plsx + pools.plsxInc.plsx,
    },
    INC: {
      usd: isoInitialPrices.INC * (pools.plsInc.inc + pools.plsxInc.inc),
      token: pools.plsInc.inc + pools.plsxInc.inc,
    },
  }

  let totalInjected = 0
  let effectiveInjected = 0
  let totalMevCost = 0
  let lpWithdrawnPct = 0
  let cumulativeLpWithdrawn = 0
  const dynamicSPAccum: Record<string, number[]> = {}

  for (let i = 0; i < chunksPerToken; i++) {
    // Get current prices for dynamic sell pressure calculation
    const currentPrices = derivePrices(reflexivePools)
    const currentMultipliers: Record<string, number> = {}
    for (const t of activeTokens) {
      currentMultipliers[t] = currentPrices[t as keyof TokenPrices] / initialPrices[t as keyof TokenPrices]
    }

    for (const token of activeTokens) {
      const tokenAmount = input.amounts[token] || 0
      const chunkAmount = tokenAmount / chunksPerToken

      if (chunkAmount <= 0) continue

      // Calculate effective sell pressure (static or dynamic)
      const effectiveSP = getDynamicSellPressure(
        input.sellPressure[token] || 0,
        currentMultipliers[token] || 1,
        input.dynamicSellPressure
      )

      // Track dynamic SP
      if (!dynamicSPAccum[token]) dynamicSPAccum[token] = []
      dynamicSPAccum[token].push(effectiveSP)

      const effectiveAmount = chunkAmount * (1 - effectiveSP)
      const mevCost = input.mevTax ? chunkAmount * MEV_TAX : 0
      totalMevCost += mevCost

      totalInjected += chunkAmount
      effectiveInjected += effectiveAmount

      // Reflexive buy
      simulateBuy(reflexivePools, token, effectiveAmount, fee)

      // Non-reflexive buy (same SP applied)
      simulateBuyIsolated(isolatedPools, token, effectiveAmount, fee)

      // Record state
      const reflexPrices = derivePrices(reflexivePools)
      const noReflexPrices: TokenPrices = {
        PLS: isolatedPools.PLS.usd / isolatedPools.PLS.token,
        HEX: isolatedPools.HEX.usd / isolatedPools.HEX.token,
        PLSX: isolatedPools.PLSX.usd / isolatedPools.PLSX.token,
        INC: isolatedPools.INC.usd / isolatedPools.INC.token,
      }

      chunks.push({
        chunkNumber: chunks.length + 1,
        token,
        amountUsd: effectiveAmount,
        prices: { ...reflexPrices },
        pricesNoReflexivity: { ...noReflexPrices },
      })
    }

    // After each round: apply LP withdrawal if enabled
    if (input.lpWithdrawal && i > 0 && i % 5 === 0) {
      const roundPrices = derivePrices(reflexivePools)
      const withdrawn = applyLPWithdrawal(reflexivePools, initialPrices, roundPrices, cumulativeLpWithdrawn)
      cumulativeLpWithdrawn += withdrawn / 100
      lpWithdrawnPct = Math.max(lpWithdrawnPct, withdrawn)
    }

    // Note: no cross-pool arbitrage applied (matches Pampi behavior)
  }

  const finalPrices = chunks.length > 0 ? chunks[chunks.length - 1].prices : initialPrices
  const finalPricesNoReflexivity = chunks.length > 0
    ? chunks[chunks.length - 1].pricesNoReflexivity
    : initialPrices

  const multipliers: TokenPrices = {
    PLS: finalPrices.PLS / initialPrices.PLS,
    HEX: finalPrices.HEX / initialPrices.HEX,
    PLSX: finalPrices.PLSX / initialPrices.PLSX,
    INC: finalPrices.INC / initialPrices.INC,
  }

  const multipliersNoReflexivity: TokenPrices = {
    PLS: finalPricesNoReflexivity.PLS / initialPrices.PLS,
    HEX: finalPricesNoReflexivity.HEX / initialPrices.HEX,
    PLSX: finalPricesNoReflexivity.PLSX / initialPrices.PLSX,
    INC: finalPricesNoReflexivity.INC / initialPrices.INC,
  }

  // Calculate average dynamic SP per token
  const dynamicSellPressureApplied: Record<string, number> = {}
  for (const [token, values] of Object.entries(dynamicSPAccum)) {
    dynamicSellPressureApplied[token] = Math.round(
      (values.reduce((a, b) => a + b, 0) / values.length) * 100
    )
  }

  // Reality score
  const realityScore = calculateRealityScore(totalInjected, totalLiquidityUsd || totalInjected * 0.1)

  return {
    initialPrices,
    finalPrices,
    finalPricesNoReflexivity,
    multipliers,
    multipliersNoReflexivity,
    chunks,
    totalInjected,
    effectiveInjected,
    poolState: reflexivePools,
    initialPoolState,
    realityScore,
    lpWithdrawnPct,
    totalMevCost,
    dynamicSellPressureApplied,
  }
}

// ─── Realistic Dampening ───

/**
 * Apply realistic dampening to AMM multipliers.
 *
 * The pure AMM math assumes a closed system. In reality:
 * - Arbitrageurs equalize prices across chains/CEX in seconds
 * - Organic selling increases as price rises
 * - Slippage tolerance limits extreme moves
 *
 * Model: realistic = m ^ exponent, where exponent decreases
 * with injection/liquidity ratio (larger = less realistic).
 *   ratio 0.09 → exponent ~0.92 (small injection, close to AMM)
 *   ratio 0.85 → exponent ~0.54 (stress-test, significant dampening)
 *   ratio 8.5  → exponent ~0.25 (extreme, heavy dampening)
 */
export function realisticMultiplier(ammMultiplier: number, injectionRatio: number): number {
  if (ammMultiplier <= 1) return ammMultiplier
  const exponent = Math.max(0.25, 1 / (1 + injectionRatio))
  return Math.pow(ammMultiplier, exponent)
}

// ─── Utility ───

/** Format number with space as thousands separator (e.g. 1 234 567) */
function spaceNum(n: number | string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatPrice(price: number): string {
  if (price >= 1_000) return `$${spaceNum(Math.round(price))}`
  if (price >= 1) return `$${price.toFixed(2)}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  if (price >= 0.0001) return `$${price.toFixed(6)}`
  const str = price.toFixed(20)
  const match = str.match(/^0\.(0*)/)
  if (match) {
    const zeros = match[1].length
    return `$0.${'0'.repeat(zeros)}${price.toFixed(zeros + 4).split('.')[1].slice(zeros)}`
  }
  return `$${price.toPrecision(4)}`
}

export function formatMultiplier(m: number): string {
  if (m >= 1_000) return `${spaceNum(Math.round(m))}x`
  if (m >= 100) return `${m.toFixed(0)}x`
  if (m >= 10) return `${m.toFixed(1)}x`
  return `${m.toFixed(2)}x`
}

/** Format number with space separator for UI display */
export function formatWithSpaces(n: number): string {
  return spaceNum(n)
}

export function formatPercent(p: number): string {
  const pct = (p - 1) * 100
  if (pct >= 1000) return `+${(pct / 1000).toFixed(1)}K%`
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}
