export type Sentiment = 'bullish' | 'bearish' | 'neutral';
export type ImpactDirection = 'up' | 'down' | 'flat';

export interface Classification {
  sentiment: Sentiment;
  impact: ImpactDirection;
  confidence: number; // 0..1
}

export interface AnalyzeInput {
  headline: string;
  body?: string;
  source?: string;
  publishedAt?: string; // ISO string
}

// Core normalized representation of an article fetched from any provider.
export interface Article {
  id: string; // provider-specific id or constructed hash
  url: string;
  source: string; // provider source name or domain
  title: string;
  description?: string;
  publishedAt?: string; // ISO timestamp
  content?: string; // may be truncated depending on provider
  author?: string;
  language?: string;
}

// Rare earth relevance assessment separate from market sentiment classification.
export interface RareEarthRelevance {
  relevant: boolean; // true if article materially concerns rare earth metals
  confidence: number; // 0..1 model confidence
  matchedTerms: string[]; // list of detected element names / domain terms
  rationale?: string; // short explanation from model
  // Automotive-focused enrichment
  automotiveRelevant?: boolean; // true if context links metals to automotive / EV industry (motors, batteries, supply chain)
  automotiveContextTerms?: string[]; // matched automotive terms (e.g. 'EV', 'battery', 'motor', 'magnet')
  category?: 'magnet' | 'battery' | 'mixed' | 'other'; // dominant usage category inferred
  usage?: string; // brief usage phrase (e.g. 'NdFeB motor magnet', 'lithium-ion battery cathode')
}

// Price impact assessment specific to rare earth metals market.
export interface RareEarthPriceImpact {
  direction: 'up' | 'down' | 'uncertain'; // expected short-term price move
  confidence: number; // 0..1
  drivers: string[]; // key causal factors extracted (e.g. 'export controls', 'supply shortage')
  reasoning?: string; // brief model explanation (trimmed)
}

// Aggregate summary over all processed automotive-relevant rare earth articles.
export interface AggregatedSummary {
  totalArticles: number; // total fetched
  totalRelevant: number; // automotive relevant kept
  magnetCount: number; // articles categorized as magnet
  batteryCount: number; // articles categorized as battery
  mixedCount: number; // mixed magnet+battery
  otherCount: number; // other category but automotive relevant
  avgRelevanceConfidence: number; // 0..1
  avgSentimentConfidence: number; // 0..1
  avgPriceImpactConfidence: number; // 0..1
  priceImpactDistribution: { up: number; down: number; uncertain: number }; // counts
  sentimentDistribution: { bullish: number; bearish: number; neutral: number }; // counts
  dominantDrivers: string[]; // top recurring drivers
  narrative: string; // concise synthesized narrative
}
