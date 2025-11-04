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
