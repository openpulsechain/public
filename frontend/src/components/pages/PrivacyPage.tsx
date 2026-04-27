import { Shield, Eye, Database, Lock, Globe, Mail } from 'lucide-react'

export function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-4">
      {/* Header */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#8000E0] bg-clip-text text-transparent">
          Privacy Policy
        </h1>
        <p className="text-gray-400 text-sm">Last updated: April 3, 2026</p>
      </div>

      {/* Intro */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/20 p-2">
            <Shield className="h-5 w-5 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Our Commitment</h2>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          OpenPulsechain is an open-source analytics platform for the PulseChain blockchain. We are committed to protecting your privacy.
          This policy explains what data we collect (spoiler: almost none), how we use it, and your rights.
        </p>
      </section>

      {/* No personal data */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-[#00D4FF]/20 p-2">
            <Eye className="h-5 w-5 text-[#00D4FF]" />
          </div>
          <h2 className="text-lg font-bold text-white">What We Don't Collect</h2>
        </div>
        <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
          <li>No personal information (name, email, phone number)</li>
          <li>No authentication data (passwords, tokens, session cookies)</li>
          <li>No financial or payment information</li>
          <li>No browsing history or tracking cookies</li>
          <li>No IP address logging or geolocation data</li>
          <li>No analytics or advertising trackers (no Google Analytics, no Facebook Pixel)</li>
          <li>No user accounts — the platform is fully anonymous</li>
        </ul>
      </section>

      {/* What we process */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-[#8000E0]/20 p-2">
            <Database className="h-5 w-5 text-[#8000E0]" />
          </div>
          <h2 className="text-lg font-bold text-white">What We Process</h2>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          OpenPulsechain processes only <strong className="text-gray-300">public blockchain data</strong> from PulseChain. This includes:
        </p>
        <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
          <li>Token smart contract addresses (public, on-chain)</li>
          <li>Transaction data from PulseX Subgraph (public, on-chain)</li>
          <li>Bridge transfer data from OmniBridge and Hyperlane (public, on-chain)</li>
          <li>Token prices derived from PulseX liquidity pools (public, on-chain)</li>
        </ul>
        <p className="text-sm text-gray-400 leading-relaxed mt-2">
          All data displayed on the platform comes from public blockchain sources. No private or personal information is involved.
        </p>
      </section>

      {/* Chrome Extension */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500/20 p-2">
            <Lock className="h-5 w-5 text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Chrome Extension</h2>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          The OpenPulsechain Chrome extension provides token safety scores and transaction warnings. Here is how it handles data:
        </p>
        <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
          <li><strong className="text-gray-300">Local storage only:</strong> User preferences (notification settings, auto-lock timeout) and optional password hash are stored locally on your device using Chrome's storage API. Nothing is sent to external servers.</li>
          <li><strong className="text-gray-300">Safety API queries:</strong> When you check a token or when the transaction guard activates, the extension sends the <em>public smart contract address</em> to our safety API. No wallet addresses, private keys, or personal data are transmitted.</li>
          <li><strong className="text-gray-300">Token logo images:</strong> The extension loads token logos from PulseX CDN, Piteas GitHub, and DexScreener. These are standard image requests with no tracking.</li>
          <li><strong className="text-gray-300">Notifications:</strong> Scam alerts and Chrome security warnings are generated locally based on API responses. No push notification service or external messaging is used.</li>
          <li><strong className="text-gray-300">No remote code:</strong> All JavaScript is bundled within the extension package. No code is loaded from external servers.</li>
        </ul>
      </section>

      {/* Third-party services */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-cyan-500/20 p-2">
            <Globe className="h-5 w-5 text-cyan-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Third-Party Services</h2>
        </div>
        <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
          <li><strong className="text-gray-300">Hosting:</strong> Standard server logs (IP, timestamp) may be collected by the infrastructure provider but are not accessed or stored by us.</li>
          <li><strong className="text-gray-300">Cloudflare:</strong> DNS and CDN provider. Standard edge caching and DDoS protection. We do not use Cloudflare Analytics.</li>
          <li><strong className="text-gray-300">DexScreener API:</strong> Used to resolve token names and logos. Requests contain only public contract addresses.</li>
        </ul>
      </section>

      {/* Open source */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-purple-500/20 p-2">
            <Shield className="h-5 w-5 text-purple-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Open Source Transparency</h2>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          OpenPulsechain is fully open-source. You can audit the entire codebase, including the Chrome extension,
          API server, and all indexers on our{' '}
          <a
            href="https://github.com/openpulsechain/openpulsechain"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00D4FF] hover:underline"
          >
            GitHub repository
          </a>.
        </p>
      </section>

      {/* Contact */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-rose-500/20 p-2">
            <Mail className="h-5 w-5 text-rose-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Contact</h2>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          If you have any questions about this privacy policy, you can reach us at{' '}
          <a href="mailto:contact@openpulsechain.com" className="text-[#00D4FF] hover:underline">
            contact@openpulsechain.com
          </a>.
        </p>
      </section>

      <p className="text-center text-xs text-gray-600 pb-4">
        This policy applies to the OpenPulsechain website (openpulsechain.com) and the OpenPulsechain Chrome extension.
      </p>
    </div>
  )
}
