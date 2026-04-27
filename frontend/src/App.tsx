import { lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom'
import { SEO } from './components/SEO'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { LanguageProvider, useTranslation } from './i18n'
import { Loader2, ArrowUp } from 'lucide-react'

// Lazy-loaded pages for code splitting
const OverviewPage = lazy(() => import('./components/pages/OverviewPage').then(m => ({ default: m.OverviewPage })))
const BridgePage = lazy(() => import('./components/pages/BridgePage').then(m => ({ default: m.BridgePage })))
const DexPage = lazy(() => import('./components/pages/DexPage').then(m => ({ default: m.DexPage })))
const TokensPage = lazy(() => import('./components/pages/TokensPage').then(m => ({ default: m.TokensPage })))
const ApiPage = lazy(() => import('./components/pages/ApiPage').then(m => ({ default: m.ApiPage })))
const WhalesPage = lazy(() => import('./components/pages/WhalesPage').then(m => ({ default: m.WhalesPage })))
const IntelligencePage = lazy(() => import('./components/pages/IntelligencePage').then(m => ({ default: m.IntelligencePage })))
const TokenSafetyPage = lazy(() => import('./components/pages/TokenSafetyPage').then(m => ({ default: m.TokenSafetyPage })))
const SafetyDashboardPage = lazy(() => import('./components/pages/SafetyDashboardPage').then(m => ({ default: m.SafetyDashboardPage })))
// AlertsPage merged into SafetyDashboardPage — /alerts redirects to /safety?tab=alerts
const SmartMoneyPage = lazy(() => import('./components/pages/SmartMoneyPage').then(m => ({ default: m.SmartMoneyPage })))
const WalletProfilePage = lazy(() => import('./components/pages/WalletProfilePage').then(m => ({ default: m.WalletProfilePage })))
const LeaguesPage = lazy(() => import('./components/pages/LeaguesPage').then(m => ({ default: m.LeaguesPage })))
const HeartLawPage = lazy(() => import('./components/pages/HeartLawPage').then(m => ({ default: m.HeartLawPage })))
const PrivacyPage = lazy(() => import('./components/pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })))
const DashboardPage = lazy(() => import('./components/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ManageKeyPage = lazy(() => import('./components/pages/ManageKeyPage').then(m => ({ default: m.ManageKeyPage })))
const PricingPage = lazy(() => import('./components/pages/PricingPage').then(m => ({ default: m.PricingPage })))
// HoneypotPage merged into SafetyDashboardPage — /honeypot redirects to /safety

function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-6xl font-bold text-[#8000E0] mb-4">404</p>
      <h1 className="text-2xl font-bold text-white mb-2">{t.app.not_found_title}</h1>
      <p className="text-gray-400 mb-8">{t.app.not_found_message}</p>
      <Link to="/" className="px-6 py-3 rounded-lg bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30 hover:bg-[#8000E0]/30 transition-colors font-medium">
        {t.app.not_found_button}
      </Link>
    </div>
  )
}

function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  if (!visible) return null
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-[#8000E0]/80 text-white shadow-lg hover:bg-[#8000E0] transition-all backdrop-blur-sm border border-white/10"
      aria-label="Scroll to top"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  )
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="h-8 w-8 animate-spin text-[#00D4FF]" />
    </div>
  )
}

const ROUTE_TO_PAGE: Record<string, string> = {
  '/': 'overview',
  '/dex': 'dex',
  '/tokens': 'tokens',
  '/bridge': 'bridge',
  '/whales': 'whales',
  '/intelligence': 'intelligence',
  '/api': 'api',
  '/safety': 'safety',
  '/smart-money': 'smart-money',
  '/leagues': 'leagues',
  '/heart-law': 'heart-law',
  '/honeypot': 'safety',
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  )
}

function AppInner() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const PAGE_SEO: Record<string, { title: string; description: string }> = {
    overview: { title: t.app.seo_overview_title, description: t.app.seo_overview_desc },
    dex: { title: t.app.seo_dex_title, description: t.app.seo_dex_desc },
    tokens: { title: t.app.seo_tokens_title, description: t.app.seo_tokens_desc },
    bridge: { title: t.app.seo_bridge_title, description: t.app.seo_bridge_desc },
    whales: { title: t.app.seo_whales_title, description: t.app.seo_whales_desc },
    intelligence: { title: t.app.seo_intelligence_title, description: t.app.seo_intelligence_desc },
    api: { title: t.app.seo_api_title, description: t.app.seo_api_desc },
    safety: { title: t.app.seo_safety_title, description: t.app.seo_safety_desc },
    alerts: { title: t.app.seo_alerts_title, description: t.app.seo_alerts_desc },
    'smart-money': { title: t.app.seo_smart_money_title, description: t.app.seo_smart_money_desc },
    leagues: { title: t.app.seo_leagues_title, description: t.app.seo_leagues_desc },
    'heart-law': { title: t.app.seo_heart_law_title, description: t.app.seo_heart_law_desc },
  }

  // Determine active page from URL
  const activePage = ROUTE_TO_PAGE[location.pathname] ||
    (location.pathname.startsWith('/token/') ? 'safety' : 'overview')

  const handleNavigate = (page: string) => {
    const route = Object.entries(ROUTE_TO_PAGE).find(([, p]) => p === page)
    if (route) navigate(route[0])
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#050510] text-gray-100 overflow-hidden relative">
      {/* PulseChain Aurora Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[#050510]" />

        {/* Top right - Cyan */}
        <div
          className="absolute top-[-20%] right-[-10%] w-[70vw] h-[70vh] bg-[#00D4FF]/20 rounded-full blur-[130px] mix-blend-screen"
          style={{ animation: 'liquid-1 20s ease-in-out infinite' }}
        />

        {/* Bottom left - Crimson/Rose */}
        <div
          className="absolute bottom-[-10%] left-[-20%] w-[60vw] h-[80vh] bg-[#FF0040]/15 rounded-full blur-[140px] mix-blend-screen"
          style={{ animation: 'liquid-2 25s ease-in-out infinite', animationDelay: '2s' }}
        />

        {/* Top Center - Blue Royal */}
        <div
          className="absolute top-[-10%] left-[20%] w-[50vw] h-[50vh] bg-[#4040E0]/20 rounded-full blur-[120px] mix-blend-screen"
          style={{ animation: 'liquid-3 22s ease-in-out infinite', animationDelay: '5s' }}
        />

        {/* Bottom Right - Violet */}
        <div
          className="absolute bottom-[-20%] right-[10%] w-[60vw] h-[60vh] bg-[#8000E0]/25 rounded-full blur-[130px] mix-blend-screen"
          style={{ animation: 'liquid-1 28s ease-in-out infinite', animationDelay: '1s', animationDirection: 'reverse' }}
        />

        {/* Center - Magenta glow */}
        <div
          className="absolute top-[30%] left-[30%] w-[40vw] h-[40vh] bg-[#D000C0]/15 rounded-full blur-[150px] mix-blend-screen"
          style={{ animation: 'liquid-2 30s ease-in-out infinite', animationDelay: '7s' }}
        />
      </div>

      {/* SEO */}
      <SEO
        title={PAGE_SEO[activePage]?.title}
        description={PAGE_SEO[activePage]?.description}
        path={location.pathname}
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <div className="relative z-30">
          <Header activePage={activePage} onNavigate={handleNavigate} />
        </div>
        <main className="relative z-0 mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/dex" element={<DexPage />} />
              <Route path="/tokens" element={<TokensPage />} />
              <Route path="/bridge" element={<BridgePage />} />
              <Route path="/whales" element={<WhalesPage />} />
              <Route path="/intelligence" element={<IntelligencePage />} />
              <Route path="/api" element={<ApiPage />} />
              <Route path="/safety" element={<SafetyDashboardPage />} />
              <Route path="/alerts" element={<Navigate to="/safety?tab=alerts" replace />} />
              <Route path="/smart-money" element={<SmartMoneyPage />} />
              <Route path="/leagues" element={<LeaguesPage />} />
              <Route path="/heart-law" element={<HeartLawPage />} />
              <Route path="/honeypot" element={<Navigate to="/safety" replace />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/manage" element={<ManageKeyPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/wallet/:address" element={<WalletProfilePage />} />
              <Route path="/token/:address" element={<TokenSafetyPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
      <ScrollToTopButton />
    </div>
  )
}
