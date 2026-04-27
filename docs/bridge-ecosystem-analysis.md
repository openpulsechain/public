# PulseChain Bridge Ecosystem Analysis

> Last updated: 2026-03-07

## Overview

PulseChainStats lists 7 "bridges" but only 3 are real independent bridges.
OpenPulsechain covers 2 of them (OmniBridge + Hyperlane), which represents ~99% of real bridged volume.

## Classification

### Real Bridges

| Bridge | Type | Tracked | Contract |
|--------|------|---------|----------|
| **OmniBridge** | Lock-and-mint, validators | YES | ETH: `0x1715a3e4a142d8b698131108995174f37aeba10d` |
| **Hyperlane** | Cross-chain messaging, Warp Routes | YES | PLS USDC Warp: `0xa5b0d537cebe97f087dc5fe5732d70719caaec1d` |
| **Liberty Swap** | Intent-based solver network | NO | Token LSF: `0x1e2b5d8257735ccc19cf6baf94c88626647327f8`, bridge contracts unpublished |

### Frontends / Wrappers

| Service | Reality | Tracked |
|---------|---------|---------|
| **TokensEx (ETH-PLS)** | Frontend for OmniBridge — same contracts, same user_address | YES (indistinguishable from regular OmniBridge) |
| **TokensEx (BSC-PLS)** | Own OmniBridge instance for BNB chain (first/only BSC-PLS omnibridge) | NO — separate contracts on BSC, not indexed |

### Not Bridges

| Service | Reality | Trackable |
|---------|---------|-----------|
| **ChangeNOW** | Centralized swap aggregator (non-custodial). Routes via liquidity + DEX. No lock-and-mint. | NO — CEX, not an on-chain bridge |

### Privacy Mixers

| Service | Reality | Trackable |
|---------|---------|-----------|
| **BlockBlend** | Cross-chain privacy mixer (pool-mix-redistribute). Supports ETH/BTC/BNB/PLS/AVAX/DOGE + more | Very difficult — obfuscation by design |
| **Gibs Finance** | Privacy mixer for PLS/ETH/BSC. Fees 0.5-1%. | Very difficult — obfuscation by design |

## Tracking Analysis

### Already tracked (no action needed)
- **OmniBridge**: Fully indexed via ETH+PLS subgraphs. TokensEx ETH-PLS transfers are included (same contracts).
- **Hyperlane**: Fully indexed via Hyperlane GraphQL API.

### Evaluated — NOT worth tracking
- **TokensEx BSC-PLS**: Custom bridge (NOT a real OmniBridge — no getBridgeMode(), owner is EOA).
  - PLS token on BSC: `0xCa8288Eced5E6943a56be8b0C32f4Cc0a3B9BcEa` (owner: `0x311d26d7...` EOA, pre-minted 666B PLS)
  - Vault on BSC (contract): `0xb5c2377389e478a7e0fb64af0437b3070124088a` (holds 4.83B PLS = ~$50K)
  - BNB on PulseChain: `0x518076CCE3729eF1a3877EA3647a26e278e764FE` (name: "$Wrapped BNB from BSC (TokensExpress)", supply: 172 BNB = ~$103K)
  - Mediator on PLS: `0xf1dfc63e10ff01b8c3d307529b47aefad2154c0e` (contract)
  - **Total TVL: ~$153K — NEGLIGIBLE, not worth building an indexer**

- **Liberty Swap**: Intent-based with own contracts. Would need:
  - Published bridge contract addresses (currently unpublished)
  - Custom indexer for their solver events
  - Priority: LOW (very small volume, niche)

### Cannot be meaningfully tracked
- **ChangeNOW**: Not a bridge, just a swap service. No on-chain bridge contracts.
- **BlockBlend / Gibs Finance**: Privacy mixers — tracking deposits/withdrawals is possible if contracts are found, but the input-output correlation is deliberately broken. Not useful for bridge analytics.

## Coverage Summary

```
OpenPulsechain coverage vs PulseChainStats "7 bridges":

  OmniBridge ........... COVERED (includes TokensEx ETH-PLS)
  Hyperlane ............ COVERED
  TokensEx BSC-PLS ..... EVALUATED — $153K TVL, not worth indexing
  Liberty Swap ......... GAP (small volume, low priority)
  ChangeNOW ............ N/A (not a bridge)
  BlockBlend ........... N/A (privacy mixer)
  Gibs Finance ......... N/A (privacy mixer)

  Real bridge coverage: 2/3 bridges = ~99% of volume
  Marketing coverage:   2/7 "bridges" listed by PulseChainStats
```
