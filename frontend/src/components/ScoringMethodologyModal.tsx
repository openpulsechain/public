import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Shield, Bug, FileCode, Droplets, Users, Clock, TrendingUp, AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

export function ScoringMethodologyModal({ open, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll
  useEffect(() => {
    if (!open) return
    const originalStyle = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = originalStyle }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-gray-900 shadow-2xl animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 border-b border-white/10 bg-gray-900/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-400/10 border border-cyan-400/20">
              <Shield className="h-5 w-5 text-[#00D4FF]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Safety Scoring Methodology</h2>
              <p className="text-xs text-gray-500">How tokens are graded from A to F</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 text-sm">
          {/* Intro */}
          <section>
            <p className="text-gray-300 leading-relaxed">
              Each token receives a <span className="text-white font-semibold">composite safety score from 0 to 100</span>,
              computed deterministically from five independent pillars. No AI, no LLM — just on-chain data,
              contract analysis, and mathematical aggregation.
            </p>
          </section>

          {/* 5 Pillars */}
          <section>
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#00D4FF]" /> The 5 Pillars (100 points total)
            </h3>
            <p className="text-[11px] text-gray-500 mb-3">
              <span className="text-amber-400 font-semibold">Important:</span> each pillar gives <span className="text-white">points when the token passes</span>.
              A score of 100 means the token is safe across all 5 dimensions. A score of 0 means it fails everywhere.
            </p>
            <div className="space-y-2">
              <PillarRow
                icon={<Bug className="h-4 w-4" />}
                name="Honeypot Check"
                weight={30}
                desc="+30 pts if NOT a honeypot (simulation passes, taxes < 5%). 0 pts if confirmed honeypot."
              />
              <PillarRow
                icon={<FileCode className="h-4 w-4" />}
                name="Contract Analysis"
                weight={25}
                desc="+25 pts if source verified, ownership renounced, no mint/blacklist/pause/selfdestruct"
              />
              <PillarRow
                icon={<Droplets className="h-4 w-4" />}
                name="Liquidity"
                weight={20}
                desc="+20 pts if liquidity ≥ $1M on PulseX. Graduated: $500K=18, $100K=16, $10K=8, <$1K=1"
              />
              <PillarRow
                icon={<Users className="h-4 w-4" />}
                name="Holders"
                weight={15}
                desc="+15 pts if 50+ holders and top 10 holds < 30%. Deducted for concentration."
              />
              <PillarRow
                icon={<Clock className="h-4 w-4" />}
                name="Age & Activity"
                weight={10}
                desc="+10 pts if token is ≥ 2 years old with active transactions (logarithmic curve)"
              />
            </div>
          </section>

          {/* Grade thresholds */}
          <section>
            <h3 className="text-white font-semibold mb-3">Grade Thresholds</h3>
            <div className="grid grid-cols-5 gap-2">
              <GradeBadge grade="A" range="≥ 80" color="emerald" />
              <GradeBadge grade="B" range="≥ 60" color="cyan" />
              <GradeBadge grade="C" range="≥ 40" color="amber" />
              <GradeBadge grade="D" range="≥ 20" color="orange" />
              <GradeBadge grade="F" range="< 20" color="red" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <div className="text-emerald-400 font-semibold text-xs">SAFE</div>
                <div className="text-[11px] text-gray-400">Grades A &amp; B (score ≥ 60)</div>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <div className="text-red-400 font-semibold text-xs">RISKY</div>
                <div className="text-[11px] text-gray-400">Grades C, D, F (score &lt; 60)</div>
              </div>
            </div>
          </section>

          {/* Grade A criteria */}
          <section>
            <h3 className="text-white font-semibold mb-3">What Grade A Requires</h3>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <Req text="Not a honeypot (on-chain simulation passes)" />
              <Req text="Buy/sell taxes below 5%" />
              <Req text="Source code verified on block explorer" />
              <Req text="No mint function, or ownership renounced" />
              <Req text="No proxy, blacklist, pause, selfdestruct" />
              <Req text="Liquidity ≥ $1M USD on PulseX" />
              <Req text="50+ holders, top 10 holds &lt; 30%" />
              <Req text="Age ≥ 2 years with active transactions" />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              A token must score across <span className="text-white">all five pillars</span> — no single area
              can compensate for a weakness elsewhere.
            </p>
          </section>

          {/* Grade B */}
          <section>
            <h3 className="text-white font-semibold mb-3">Grade B — Safe with Compromises</h3>
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-1 text-gray-300">
              <p className="text-xs">Good overall score but one or more of:</p>
              <ul className="text-xs space-y-1 mt-2 text-gray-400">
                <li>• Liquidity between $10K and $1M</li>
                <li>• Top holders hold 30–50% of supply</li>
                <li>• Contract has minor flags (proxy, mint not renounced)</li>
                <li>• Token age between 30 days and 1 year</li>
              </ul>
            </div>
          </section>

          {/* Reputation adjustments */}
          <section>
            <h3 className="text-white font-semibold mb-3">Reputation Adjustments</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/[0.03] p-3">
                <div className="text-emerald-400 text-xs font-semibold mb-1.5">Bonuses (+)</div>
                <ul className="text-[11px] text-gray-400 space-y-0.5">
                  <li>+5 Canonical token (WPLS, HEX, PLSX…)</li>
                  <li>+3 Age ≥ 365d &amp; 500+ holders</li>
                  <li>+2 Excellent deployer track record</li>
                </ul>
              </div>
              <div className="rounded-lg border border-red-500/10 bg-red-500/[0.03] p-3">
                <div className="text-red-400 text-xs font-semibold mb-1.5">Malus (−)</div>
                <ul className="text-[11px] text-gray-400 space-y-0.5">
                  <li>−50 Deployer OFAC sanctioned</li>
                  <li>−20 Deployer = serial attacker (3+ exploits)</li>
                  <li>−15 Deployer flagged HIGH risk</li>
                  <li>−10 Critical scam alert active</li>
                  <li>−10 Deployer dead ratio &gt; 80%</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Score caps */}
          <section>
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Hard Caps (Automatic Downgrades)
            </h3>
            <div className="space-y-2 text-xs">
              <CapRow trigger="Token is a honeypot" effect="Score = 0" />
              <CapRow trigger="Critical scam risk detected" effect="Score capped at 30 (D/F)" />
              <CapRow trigger="High scam risk detected" effect="Score capped at 50 (C/D)" />
              <CapRow trigger="Liquidity < $1K" effect="Grade capped at D" />
              <CapRow trigger="Liquidity < $10K" effect="Grade capped at C" />
              <CapRow trigger="Liquidity < $50K" effect="Grade capped at B" />
            </div>
          </section>

          {/* Scam Detection */}
          <section>
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" /> Scam Detection (Independent Score 0-100)
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Alongside the safety score, every token receives a separate <span className="text-white">scam risk score (0-100)</span> that
              aggregates signals across 8 categories. High scam scores cap the overall safety grade.
            </p>

            <div className="grid grid-cols-4 gap-2 mb-4">
              <ScamRiskBadge level="LOW" range="0-29" color="emerald" />
              <ScamRiskBadge level="MEDIUM" range="30-49" color="amber" />
              <ScamRiskBadge level="HIGH" range="50-69" color="orange" />
              <ScamRiskBadge level="CRITICAL" range="≥ 70" color="red" />
            </div>

            <p className="text-xs text-gray-300 font-semibold mb-2">Scam signals (accumulate to 0-100):</p>

            <div className="space-y-2">
              <ScamCat title="1. Liquidity" items={[
                { label: "Near-zero (< $100)", severity: "critical", points: "+30" },
                { label: "Very low (< $1K)", severity: "high", points: "+20" },
                { label: "Low (< $10K)", severity: "medium", points: "+10" },
              ]} />

              <ScamCat title="2. Holder Concentration" items={[
                { label: "Top 1 > 90% (extreme)", severity: "critical", points: "+30" },
                { label: "Top 1 > 40%", severity: "high", points: "+15" },
                { label: "Top 10 > 70%", severity: "medium", points: "+10" },
              ]} />

              <ScamCat title="3. Token Age" items={[
                { label: "< 24h old (brand new)", severity: "high", points: "+15" },
                { label: "< 7 days old", severity: "medium", points: "+8" },
              ]} />

              <ScamCat title="4. Activity" items={[
                { label: "< 10 transactions (no activity)", severity: "high", points: "+10" },
                { label: "< 50 transactions (low activity)", severity: "medium", points: "+5" },
              ]} />

              <ScamCat title="5. LP Removals (rug signal, low liq only)" items={[
                { label: "10+ LP removals in 24h", severity: "critical", points: "+15" },
                { label: "5+ LP removals in 24h", severity: "high", points: "+8" },
                { label: "3+ LP removals in 24h", severity: "medium", points: "+3" },
              ]} />

              <ScamCat title="6. Contract Risks (non-honeypot)" items={[
                { label: "Unverified source code", severity: "medium", points: "+8" },
                { label: "Mint function + active owner", severity: "high", points: "+12" },
                { label: "Unverified + top holder > 30%", severity: "high", points: "+15" },
              ]} />

              <ScamCat title="7. Deployer Reputation" items={[
                { label: "Serial rugger (dead_ratio > 80%)", severity: "critical", points: "+25" },
                { label: "Risky deployer (dead_ratio > 60%)", severity: "high", points: "+15" },
              ]} />

              <ScamCat title="8. Intel Signals" items={[
                { label: "Deployer flagged in intel DB", severity: "critical", points: "+20" },
                { label: "2+ negative intel events", severity: "high", points: "+10" },
                { label: "Active critical alerts (whale dump, rug)", severity: "critical", points: "+25" },
                { label: "Active high severity alerts", severity: "high", points: "+12" },
              ]} />
            </div>

            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-[11px] text-amber-300">
                <span className="font-semibold">Amplifier:</span> if a token has 2+ critical signals,
                the total scam score is multiplied by 1.3× (capped at 100).
              </p>
            </div>

            <div className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <p className="text-[11px] text-cyan-300">
                <span className="font-semibold">LP-immune categories:</span> WPLS, stablecoins, bridged tokens, and
                ecosystem core tokens ignore LP removal alerts (these are rug pulls of <em>other</em> tokens
                sharing pairs with them, not issues with the canonical token itself).
              </p>
            </div>
          </section>

          {/* Trusted categories */}
          <section>
            <h3 className="text-white font-semibold mb-3">Trusted Categories (Special Handling)</h3>
            <p className="text-xs text-gray-400 mb-3">
              Infrastructure, stablecoins, and bridged blue chips get <span className="text-white">score floors</span> and
              are exempt from concentration penalties (their top holders are routers, bridges, or protocol contracts by design).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-white font-semibold">Infrastructure</div>
                <div className="text-gray-500 text-[11px]">WPLS — min score 90</div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-white font-semibold">Stablecoins</div>
                <div className="text-gray-500 text-[11px]">USDC, DAI, USDT — min 85</div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-white font-semibold">Blue Chip Bridge</div>
                <div className="text-gray-500 text-[11px]">WETH, WBTC — min 80</div>
              </div>
            </div>
          </section>

          {/* Data sources */}
          <section>
            <h3 className="text-white font-semibold mb-3">Data Sources</h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>• <span className="text-gray-300">PulseChain RPC</span> — direct on-chain calls (honeypot simulation, contract bytecode)</li>
              <li>• <span className="text-gray-300">Blockscout API</span> — contract verification, source code, holder list</li>
              <li>• <span className="text-gray-300">PulseX Subgraph</span> — liquidity, pairs, burn/mint events</li>
              <li>• <span className="text-gray-300">Intel signals</span> — known bad actors, exploit history, scam alerts</li>
            </ul>
            <p className="text-[11px] text-gray-600 mt-3 italic">
              100% deterministic scoring. No machine learning. Results are reproducible by re-running the same inputs.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}

function PillarRow({ icon, name, weight, desc }: { icon: React.ReactNode; name: string; weight: number; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[#00D4FF]">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-white font-medium text-sm">{name}</span>
          <span className="text-[#00D4FF] font-mono text-xs font-semibold">{weight} pts</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">{desc}</div>
      </div>
    </div>
  )
}

function GradeBadge({ grade, range, color }: { grade: string; range: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    orange: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
    red: 'border-red-500/30 bg-red-500/10 text-red-400',
  }
  return (
    <div className={`rounded-lg border ${colorMap[color]} py-2 text-center`}>
      <div className="text-lg font-black">{grade}</div>
      <div className="text-[10px] font-mono opacity-80">{range}</div>
    </div>
  )
}

function Req({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-gray-300">
      <span className="text-emerald-400 mt-0.5">✓</span>
      <span>{text}</span>
    </div>
  )
}

function CapRow({ trigger, effect }: { trigger: string; effect: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-amber-500/10 bg-amber-500/[0.03] px-3 py-2">
      <span className="text-gray-400">{trigger}</span>
      <span className="text-amber-400 font-mono text-[11px]">{effect}</span>
    </div>
  )
}

function ScamRiskBadge({ level, range, color }: { level: string; range: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    orange: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
    red: 'border-red-500/30 bg-red-500/10 text-red-400',
  }
  return (
    <div className={`rounded-lg border ${colorMap[color]} py-2 px-2 text-center`}>
      <div className="text-[11px] font-black">{level}</div>
      <div className="text-[10px] font-mono opacity-80">{range}</div>
    </div>
  )
}

function ScamCat({ title, items }: { title: string; items: { label: string; severity: string; points: string }[] }) {
  const sevColor = (s: string) =>
    s === 'critical' ? 'text-red-400 border-red-500/20 bg-red-500/5'
    : s === 'high' ? 'text-orange-400 border-orange-500/20 bg-orange-500/5'
    : 'text-amber-400 border-amber-500/20 bg-amber-500/5'
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
      <div className="text-[11px] font-semibold text-gray-300 mb-1.5">{title}</div>
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400">{it.label}</span>
            <span className={`font-mono px-1.5 py-0.5 rounded border ${sevColor(it.severity)}`}>
              {it.points}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
