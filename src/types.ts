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
}
