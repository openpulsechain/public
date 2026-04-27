// ╔══════════════════════════════════════════════════════════════════╗
// ║ INVARIANT — DO NOT BREAK                                         ║
// ║ Both verdict cards (Honeypot + Scam) MUST ALWAYS render.         ║
// ║ No conditional rendering based on score/signals is allowed.      ║
// ║ A safety analysis = Honeypot verdict + Scam verdict. Always.     ║
// ║ Enforced by scripts/safety-invariant-check.mjs (prebuild).       ║
// ║ If you are tempted to hide a card: DON'T. Use a "LOW RISK" /     ║
// ║ "LOADING" state instead.                                         ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface HoneypotVerdict {
  is_honeypot: boolean | null
}

export interface ScamVerdict {
  scam_score: number
  risk_level: 'critical' | 'high' | 'medium' | 'low'
}

interface Labels {
  honeypot_title: string
  scam_title: string
  verdict_honeypot: string
  verdict_safe: string
  verdict_inconclusive: string
  verdict_honeypot_message: string
  verdict_safe_message: string
  verdict_inconclusive_message: string
}

interface Props {
  hp: HoneypotVerdict
  scam: ScamVerdict | null
  labels: Labels
}

const SCAM_STYLES: Record<ScamVerdict['risk_level'], { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20',      border: 'border-red-500/40',     text: 'text-red-400',     label: 'CRITICAL RISK' },
  high:     { bg: 'bg-orange-500/20',   border: 'border-orange-500/40',  text: 'text-orange-400',  label: 'HIGH RISK' },
  medium:   { bg: 'bg-yellow-500/15',   border: 'border-yellow-500/40',  text: 'text-yellow-400',  label: 'MEDIUM RISK' },
  low:      { bg: 'bg-emerald-500/15',  border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'LOW RISK' },
}

const LOADING_STYLE = { bg: 'bg-gray-700/30', border: 'border-gray-600/30', text: 'text-gray-400', label: 'NO DATA' }

export function SafetyVerdictGrid({ hp, scam, labels }: Props) {
  const scamStyle = scam ? SCAM_STYLES[scam.risk_level] : LOADING_STYLE

  const honeypotBg =
    hp.is_honeypot === true  ? 'bg-red-500/20 border-2 border-red-500/40' :
    hp.is_honeypot === false ? 'bg-emerald-500/15 border-2 border-emerald-500/30' :
                               'bg-gray-700/30 border-2 border-gray-600/30'

  const honeypotText =
    hp.is_honeypot === true  ? 'text-red-400' :
    hp.is_honeypot === false ? 'text-emerald-400' :
                               'text-gray-400'

  const honeypotLabel =
    hp.is_honeypot === true  ? labels.verdict_honeypot :
    hp.is_honeypot === false ? labels.verdict_safe :
                               labels.verdict_inconclusive

  const honeypotMessage =
    hp.is_honeypot === true  ? labels.verdict_honeypot_message :
    hp.is_honeypot === false ? labels.verdict_safe_message :
                               labels.verdict_inconclusive_message

  return (
    <div className="grid gap-3 grid-cols-2" data-testid="safety-verdict-grid">
      {/* ── HONEYPOT CARD — always rendered ── */}
      <div
        data-testid="safety-verdict-honeypot"
        className={`rounded-xl px-6 py-5 text-center ${honeypotBg}`}
      >
        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">
          {labels.honeypot_title}
        </div>
        <div className={`text-2xl font-black tracking-wide ${honeypotText}`}>
          {honeypotLabel}
        </div>
        <p className="text-xs text-gray-400 mt-1">{honeypotMessage}</p>
      </div>

      {/* ── SCAM CARD — always rendered ── */}
      <div
        data-testid="safety-verdict-scam"
        className={`rounded-xl px-6 py-5 text-center ${scamStyle.bg} border-2 ${scamStyle.border}`}
      >
        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">
          {labels.scam_title}
        </div>
        <div className={`text-2xl font-black tracking-wide ${scamStyle.text}`}>
          {scamStyle.label}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {scam ? `Scam Score: ${scam.scam_score}/100` : 'Analysis loading…'}
        </p>
      </div>
    </div>
  )
}
