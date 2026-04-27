export interface BridgeDailyStats {
  date: string
  deposit_count: number
  withdrawal_count: number
  deposit_volume_usd: number
  withdrawal_volume_usd: number
  net_flow_usd: number
  unique_users: number
}

export interface BridgeTokenStats {
  token_address: string
  token_symbol: string | null
  total_deposit_count: number
  total_withdrawal_count: number
  total_deposit_volume_usd: number
  total_withdrawal_volume_usd: number
  net_flow_usd: number
  last_bridge_at: string | null
}

export interface BridgeTransfer {
  id: string
  direction: 'deposit' | 'withdrawal'
  status: string
  user_address: string
  token_symbol: string | null
  token_decimals: number | null
  amount_raw: string
  amount_usd: number | null
  message_id: string | null
  tx_hash_eth: string | null
  tx_hash_pls: string | null
  block_timestamp: string
  chain_source: string
}

export interface NetworkTvl {
  date: string
  tvl_usd: number
}

export interface NetworkDexVolume {
  date: string
  volume_usd: number
}

export interface TokenPrice {
  id: string
  symbol: string
  name: string | null
  price_usd: number | null
  market_cap_usd: number | null
  volume_24h_usd: number | null
  price_change_24h_pct: number | null
  last_updated: string
  address: string | null
  source: string | null
}

export interface NetworkSnapshot {
  block_number: number
  gas_price_gwei: number
  base_fee_gwei: number
  timestamp: string
}

export interface PulsexDailyStats {
  date: string
  daily_volume_usd: number
  total_liquidity_usd: number
  total_volume_usd: number
  total_transactions: number
}

export interface PulsexDefillamaTvl {
  date: string
  tvl_usd: number
}

export interface PulsexDefillamaVolume {
  date: string
  volume_usd: number
}

export interface PulsexTopPair {
  pair_address: string
  token0_symbol: string
  token0_name: string
  token1_symbol: string
  token1_name: string
  volume_usd: number
  reserve_usd: number
  total_transactions: number
  daily_volume_usd?: number
  updated_at?: string
}

export interface HyperlaneTransfer {
  id: number
  msg_id: string | null
  direction: 'inbound' | 'outbound'
  is_delivered: boolean
  origin_chain_id: number
  origin_chain_name: string | null
  destination_chain_id: number
  destination_chain_name: string | null
  sender_address: string | null
  recipient_address: string | null
  origin_tx_sender: string | null
  origin_tx_hash: string | null
  destination_tx_hash: string | null
  token_symbol: string | null
  token_decimals: number | null
  amount_raw: string | null
  amount_usd: number | null
  send_occurred_at: string
  delivery_occurred_at: string | null
  nonce: number
}

export interface HyperlaneDailyStats {
  date: string
  inbound_count: number
  outbound_count: number
  inbound_volume_usd: number
  outbound_volume_usd: number
  net_flow_usd: number
  unique_users: number
  unique_chains: number
}

export interface BridgeTvlToken {
  token_symbol: string
  net_amount: number
  price_usd: number
  tvl_usd: number
  pct_of_total: number
}

export interface WhaleAddress {
  address: string
  total_usd: number
  token_count: number
  top_tokens: string | null
  is_contract: boolean
}

export interface WhaleHolding {
  address: string
  token_address: string
  token_symbol: string
  balance: number
  balance_usd: number
  rank: number
  is_contract: boolean
}

export interface WhaleLink {
  id: number
  address_from: string
  address_to: string
  link_type: string
  detail: string | null
  updated_at: string
}

export interface HyperlaneChainStats {
  chain_id: number
  chain_name: string | null
  total_inbound_count: number
  total_outbound_count: number
  total_inbound_volume_usd: number
  total_outbound_volume_usd: number
  net_flow_usd: number
  last_transfer_at: string | null
}

export interface IntelConclusion {
  id: number
  conclusion_type: string
  subject: string
  title: string
  summary: string
  evidence: any[] | string | null
  addresses_involved: string[] | null
  tokens_involved: string[] | null
  risk_level: string
  tweet_count: number
  first_seen: string
  last_seen: string
  is_active: boolean
}

export interface LlmAnalysis {
  id: number
  tweet_id: string
  sentiment: string | null
  action_detected: string | null
  risk_level: string | null
  summary: string | null
  addresses_mentioned: any[] | null
  tokens_mentioned: string[] | null
  amounts_mentioned: any[] | null
  relationships: any[] | null
}

export interface ResearchTweet {
  id: string
  text: string
  author_username: string
  author_name: string
  tweet_url: string
  like_count: number
  retweet_count: number
  tweeted_at: string
}

export interface HolderLeagueCurrent {
  token_symbol: string
  token_address: string
  total_holders: number
  total_supply: string
  total_supply_human: number
  poseidon_count: number
  whale_count: number
  shark_count: number
  dolphin_count: number
  squid_count: number
  turtle_count: number
  // Entity-adjusted counts (families = 1 entity)
  total_entities: number | null
  poseidon_entities: number | null
  whale_entities: number | null
  shark_entities: number | null
  dolphin_entities: number | null
  squid_entities: number | null
  turtle_entities: number | null
  family_count: number | null
  updated_at: string
}

export interface HolderLeagueAddress {
  token_symbol: string
  holder_address: string
  balance_raw: string
  balance_pct: number
  tier: string
  family_id: string | null
  scraped_at: string
}

export interface HolderLeagueFamily {
  token_symbol: string
  family_id: string
  mother_address: string
  daughter_count: number
  combined_balance_pct: number
  combined_tier: string
  individual_tier: string
  link_types: string[]
  confidence_score: number | null
  scraped_at: string
}

export interface LivePoolSummary {
  token_address: string
  token_symbol: string | null
  last_updated: string
  tier: 'hot' | 'warm' | 'cold'
  price_usd: number | null
  fdv: number | null
  market_cap_usd: number | null
  price_change_24h: number | null
  total_liquidity_usd: number | null
  total_volume_24h_usd: number | null
  total_buys_24h: number | null
  total_sells_24h: number | null
  pool_count_legitimate: number
  pool_count_total: number
  dex_count: number
  dex_list: string[]
  data_age_seconds: number | null
  price_median: number | null
  price_min: number | null
  price_max: number | null
  total_liquidity_base: number | null
  total_liquidity_quote: number | null
}

export interface LivePool {
  token_address: string
  pair_address: string
  updated_at: string
  tier: 'hot' | 'warm' | 'cold'
  token_symbol: string | null
  token_name: string | null
  dex_id: string | null
  base_token_symbol: string | null
  quote_token_symbol: string | null
  price_usd: number | null
  volume_24h_usd: number | null
  liquidity_usd: number | null
  liquidity_base: number | null
  liquidity_quote: number | null
  buys_24h: number | null
  sells_24h: number | null
  txns_24h: number | null
  fdv: number | null
  market_cap_usd: number | null
  price_change_5m: number | null
  price_change_1h: number | null
  price_change_6h: number | null
  price_change_24h: number | null
  dx_url: string | null
  pool_is_legitimate: boolean
  pool_confidence: string | null
  pool_spam_reason: string | null
  data_age_seconds: number | null
  freshness: string | null
}
