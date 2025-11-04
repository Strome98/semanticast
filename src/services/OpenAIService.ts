import OpenAI from 'openai';
import { AnalyzeInput, Classification } from '../types';

export class OpenAIService {
  private client: OpenAI | null;

  constructor(apiKey?: string) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  public get enabled(): boolean {
    return this.client !== null;
  }

  public async classifyNews(input: AnalyzeInput): Promise<Classification> {
    if (!this.client) {
      throw new Error('OpenAI client not configured');
    }

    const text = [input.headline, input.body].filter(Boolean).join('\n\n');

    const system = `You are a market analysis assistant.
Classify the given news text for short-term market impact.
Return ONLY a JSON object with keys: sentiment (bullish|bearish|neutral), impact (up|down|flat), confidence (0..1).
No extra text.`;

    const user = `Text:\n"""
${text}
"""`;

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
    });

    const content = completion.choices?.[0]?.message?.content ?? '';

    // Attempt to extract JSON
    const jsonText = extractJson(content);
    const parsed = JSON.parse(jsonText) as Classification;

    // Basic normalization/validation
    const sentiment = ['bullish', 'bearish', 'neutral'].includes((parsed as any).sentiment)
      ? (parsed as any).sentiment
      : 'neutral';
    const impact = ['up', 'down', 'flat'].includes((parsed as any).impact)
      ? (parsed as any).impact
      : 'flat';
    const confidence = Math.max(0, Math.min(1, Number((parsed as any).confidence ?? 0.5)));

    return { sentiment, impact, confidence };
  }
}

function extractJson(text: string): string {
  // If the model wraps JSON in code fences, strip them
  const fenceMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  // Otherwise try to find first { ... }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text.trim();
}
