import OpenAI from 'openai';
import { AnalyzeInput, Classification, Article, RareEarthRelevance } from '../types';

export class OpenAIService {
  private client: OpenAI | null;

  constructor(apiKey?: string) {
    const allowInsecure = process.env.ALLOW_INSECURE_OPENAI === 'true';
    if (allowInsecure) {
      // Disables TLS verification globally for this process. Use ONLY for debugging.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (process.env as any).NODE_TLS_REJECT_UNAUTHORIZED = '0';
      console.warn('[OpenAIService] WARNING: TLS verification disabled (ALLOW_INSECURE_OPENAI=true). Do not use in production.');
    }
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

    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.2,
      });
    } catch (e: any) {
      if (isTlsIssuerError(e)) {
        throw new Error(formatTlsGuidance('OpenAI', e));
      }
      // Rethrow other errors
      throw e;
    }

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

  /**
   * Assess whether an Article is materially about rare earth metals or their supply chain.
   * Returns structured relevance info.
   */
  public async assessRareEarthRelevance(article: Article): Promise<RareEarthRelevance> {
    if (!this.client) {
      throw new Error('OpenAI client not configured');
    }

    const text = [article.title, article.description, article.content].filter(Boolean).join('\n\n');

    const system = `You are a domain classifier focusing on rare earth elements.
Determine if the provided news text is MATERIALLY about rare earth metals, mining, refining, supply chain, regulation, pricing, export controls, geopolitical issues, or named elements.
Rare earth list (non-exhaustive): scandium, yttrium, lanthanum, cerium, praseodymium, neodymium, promethium, samarium, europium, gadolinium, terbium, dysprosium, holmium, erbium, thulium, ytterbium, lutetium, as well as strategic minerals like lithium, cobalt (only mark relevant if context connects to rare earths or critical mineral supply chain).
Return ONLY JSON with keys:
relevant (boolean), confidence (0..1), matchedTerms (string[]), rationale (short string).`;

    const user = `Article:
Title: ${article.title}
Source: ${article.source}
Published: ${article.publishedAt}
Text:\n"""\n${text}\n"""`;

    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.1,
      });
    } catch (e: any) {
      if (isTlsIssuerError(e)) {
        // Return a graceful non-relevant fallback plus rationale
        return { relevant: false, confidence: 0.1, matchedTerms: [], rationale: formatTlsGuidance('OpenAI', e).slice(0, 300) };
      }
      return { relevant: false, confidence: 0.1, matchedTerms: [], rationale: 'openai_error' };
    }

    const content = completion.choices?.[0]?.message?.content ?? '';
    const jsonText = extractJson(content);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return { relevant: false, confidence: 0.2, matchedTerms: [], rationale: 'parse_error' };
    }
    const relevant = Boolean(parsed.relevant);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
    const matchedTerms = Array.isArray(parsed.matchedTerms) ? parsed.matchedTerms.filter((t: any) => typeof t === 'string').slice(0, 50) : [];
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 300) : undefined;
    return { relevant, confidence, matchedTerms, rationale };
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

function isTlsIssuerError(e: any): boolean {
  const code = e?.code || e?.cause?.code || e?.cause?.errno;
  return code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY';
}

function formatTlsGuidance(context: string, e: any): string {
  return `${context} TLS certificate chain not trusted. Steps:\n1. Export corporate/proxy root certificate as Base64 PEM.\n2. Save to certs/corporate-root.pem inside project.\n3. Set NODE_EXTRA_CA_CERTS=full\\path\\to\\corporate-root.pem before running.\n4. (Temporary) set ALLOW_INSECURE_OPENAI=true to bypass verification.\nError: ${e.message}`;
}
