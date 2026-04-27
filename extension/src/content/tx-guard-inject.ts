// Injected into MAIN world — hooks window.ethereum.request
// Communicates with content script (ISOLATED world) via CustomEvents

const KNOWN_SAFE: Record<string, string> = {
  '0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc02': 'PulseX Router V1',
  '0x1715a3e4a142d8b698131108995f8ba62571d432': 'PulseX Factory V1',
  '0x165c3410fc91ef562c50559f7d2289febed552d9': 'PulseX Router V2',
  '0x29ea7545def87022badc76323f373ea1e707c523': 'PulseX Factory V2',
  '0xa1077a294dde1b09bb078844df40758a5d0f9a27': 'WPLS',
  '0xf7eb2a2bbde8fdf55deeeeab5f84cfc735c8b5f8': 'OmniBridge',
  '0x0000000000000000000000000000000000000369': 'Burn Address',
}

const SELECTORS: Record<string, string> = {
  '0x095ea7b3': 'approve',
  '0xa9059cbb': 'transfer',
  '0x23b872dd': 'transferFrom',
  '0x38ed1739': 'swapExactTokensForTokens',
  '0x7ff36ab5': 'swapExactETHForTokens',
  '0x18cbafe5': 'swapExactTokensForETH',
  '0xfb3bdb41': 'swapETHForExactTokens',
  '0x5c11d795': 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
  '0xb6f9de95': 'swapExactETHForTokensSupportingFeeOnTransferTokens',
  '0x791ac947': 'swapExactTokensForETHSupportingFeeOnTransferTokens',
}

const MAX_UINT256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

function hookProvider() {
  if (!window.ethereum) return false

  const originalRequest = window.ethereum.request.bind(window.ethereum)

  window.ethereum.request = async function (args: { method: string; params?: unknown[] }) {
    if (args.method === 'eth_sendTransaction' && args.params && args.params[0]) {
      const tx = args.params[0] as { to?: string; data?: string; value?: string }
      const to = tx.to?.toLowerCase() || ''
      const data = tx.data || '0x'

      // Skip pure PLS transfers (no data, no contract)
      if (data === '0x' || data === '') {
        return originalRequest(args)
      }

      // Skip known safe contracts
      if (KNOWN_SAFE[to]) {
        return originalRequest(args)
      }

      // Decode function
      const selector = data.slice(0, 10).toLowerCase()
      const fnName = SELECTORS[selector] || 'unknown'
      const isApproveInfinite = fnName === 'approve' && data.toLowerCase().includes(MAX_UINT256)

      // Ask content script (ISOLATED world) to check safety via background
      const proceed = await new Promise<boolean>((resolve) => {
        const responseHandler = (e: Event) => {
          window.removeEventListener('op-safety-result', responseHandler)
          resolve((e as CustomEvent).detail.proceed)
        }
        window.addEventListener('op-safety-result', responseHandler)

        window.dispatchEvent(new CustomEvent('op-safety-check', {
          detail: { to, data, fnName, isApproveInfinite }
        }))

        // Timeout: auto-proceed after 15s
        setTimeout(() => {
          window.removeEventListener('op-safety-result', responseHandler)
          resolve(true)
        }, 15000)
      })

      if (!proceed) {
        throw new Error('Transaction cancelled by OpenPulsechain safety check')
      }
    }

    return originalRequest(args)
  }

  return true
}

// Hook immediately or wait for provider
if (!hookProvider()) {
  let attempts = 0
  const interval = setInterval(() => {
    if (hookProvider() || ++attempts > 50) clearInterval(interval)
  }, 200)
}
