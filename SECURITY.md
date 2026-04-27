# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in OpenPulsechain, please report it responsibly.

**Email:** contact@openpulsechain.com

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Do NOT:**
- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability beyond proof-of-concept
- Access or modify other users' data

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Assessment:** within 7 days
- **Fix deployment:** as soon as possible, depending on severity

## Scope

| In scope | Out of scope |
|----------|-------------|
| api.openpulsechain.com | Third-party infrastructure services |
| safety.openpulsechain.com | PulseChain RPC/blockchain itself |
| openpulsechain.com (frontend) | DexScreener, DefiLlama, Blockscout APIs |
| MCP server (@openpulsechain/mcp-server) | |
| Chrome extension (OpenPulsechain) | |

## Security Measures

- All API endpoints are read-only (GET only)
- Row Level Security (RLS) enforced on all database tables
- CORS restricted to openpulsechain.com
- Rate limiting on all public endpoints
- Cron endpoints protected by secret + timing-safe comparison
- Automated security scanning on every push (GitHub Actions)
- No secrets in codebase — all credentials via environment variables
- Chrome extension: all data stored locally, no personal data collected
