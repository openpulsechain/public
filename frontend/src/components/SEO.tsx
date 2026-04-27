import { Helmet } from 'react-helmet-async'

const BASE_URL = 'https://www.openpulsechain.com'
const SITE_NAME = 'OpenPulsechain'
const DEFAULT_DESC = 'Open-source PulseChain analytics: token safety scores, alert radar, smart money tracking, DEX volume, bridge flows. MCP server for AI.'
const OG_IMAGE = `${BASE_URL}/og-image.svg`

interface SEOProps {
  title?: string
  description?: string
  path?: string
}

export function SEO({ title, description, path = '' }: SEOProps) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Open-Source PulseChain Analytics`
  const desc = description || DEFAULT_DESC
  const url = `${BASE_URL}${path}`

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
    </Helmet>
  )
}
