import OpenAI from 'openai';
import { AnalyzeInput, Classification, Article, RareEarthRelevance, RareEarthPriceImpact, AggregatedSummary } from '../types';

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

    const system = `You are an expert classifier for rare earth and critical minerals with an AUTOMOTIVE (EV) industry focus.
Tasks:
1. Determine if the article is MATERIALLY about rare earth metals OR critical battery/magnet minerals (list below) including mining, refining, supply chain, regulation, pricing, export controls, geopolitics.
2. Determine if the context links these minerals specifically to automotive / EV industry (EV production, batteries, motors, magnets, drivetrain, OEMs, suppliers).
3. Infer dominant usage category: magnet (neodymium, praseodymium, dysprosium, terbium, samarium context in permanent magnets / traction motors), battery (lithium, cobalt, nickel, manganese context in batteries), mixed (both), other (present but not clearly magnet/battery).
4. Provide a concise usage phrase if automotiveRelevant.

Mineral terms (non-exhaustive): neodymium, praseodymium, dysprosium, terbium, samarium, cerium, lanthanum, yttrium, scandium, europium, gadolinium, holmium, erbium, thulium, ytterbium, lutetium, lithium, cobalt, nickel, manganese, graphite.
Automotive context terms: EV, electric vehicle, electric car, automotive, auto industry, OEM, battery, battery pack, gigafactory, cell production, cathode, anode, motor, traction motor, permanent magnet, magnet, drivetrain, Tesla, BYD, Volkswagen, Toyota.

Output ONLY JSON with keys:
relevant (boolean), confidence (0..1), matchedTerms (string[]), rationale (short string <=200 chars), automotiveRelevant (boolean), automotiveContextTerms (string[]), category (magnet|battery|mixed|other), usage (string or null).
Rules:
- automotiveRelevant true ONLY if explicit automotive / EV linkage exists (not just generic mining).
- matchedTerms: dedupe, lowercase, <=20.
- automotiveContextTerms: subset matched automotive terms, lowercase, <=15.
- If relevant=false set automotiveRelevant=false.
- If automotiveRelevant=false set usage=null and category='other' unless magnet/battery clearly unrelated to autos.
Return NOTHING besides JSON.`;

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
        // Graceful fallback
        return { relevant: false, confidence: 0.1, matchedTerms: [], rationale: formatTlsGuidance('OpenAI', e).slice(0, 300), automotiveRelevant: false, automotiveContextTerms: [], category: 'other', usage: undefined };
      }
      return { relevant: false, confidence: 0.1, matchedTerms: [], rationale: 'openai_error', automotiveRelevant: false, automotiveContextTerms: [], category: 'other', usage: undefined };
    }

    const content = completion.choices?.[0]?.message?.content ?? '';
    const jsonText = extractJson(content);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return { relevant: false, confidence: 0.2, matchedTerms: [], rationale: 'parse_error', automotiveRelevant: false, automotiveContextTerms: [], category: 'other', usage: undefined };
    }
    const relevant = Boolean(parsed.relevant);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
    const matchedTerms = Array.isArray(parsed.matchedTerms) ? parsed.matchedTerms.filter((t: any) => typeof t === 'string').map((t: string)=> t.toLowerCase()).slice(0, 20) : [];
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 200) : undefined;
    const automotiveRelevant = relevant && Boolean(parsed.automotiveRelevant);
    const automotiveContextTerms = automotiveRelevant && Array.isArray(parsed.automotiveContextTerms) ? parsed.automotiveContextTerms.filter((t: any)=> typeof t === 'string').map((t: string)=> t.toLowerCase()).slice(0,15) : [];
    const category: RareEarthRelevance['category'] = automotiveRelevant && ['magnet','battery','mixed','other'].includes(parsed.category) ? parsed.category : (automotiveRelevant ? 'other' : 'other');
    const usage = automotiveRelevant && typeof parsed.usage === 'string' ? parsed.usage.slice(0,120) : undefined;
    return { relevant, confidence, matchedTerms, rationale, automotiveRelevant, automotiveContextTerms, category, usage };
  }

  /**
   * Assess expected short-term price impact direction for rare earth metals.
   * Returns JSON with direction up|down|uncertain, confidence, drivers[], reasoning.
   */
  public async assessRareEarthPriceImpact(article: Article): Promise<RareEarthPriceImpact> {
    if (!this.client) throw new Error('OpenAI client not configured');
    const text = [article.title, article.description, article.content].filter(Boolean).join('\n\n');

    const system = `You are a financial impact analyst for rare earth metals.
Decide expected SHORT-TERM (14 Days) aggregate price direction for the rare earth basket based on the article.
Only return JSON: { direction: up|down|uncertain, confidence: 0..1, drivers: string[], reasoning: string }.
Rules:
- direction 'up' if supply risk, export restrictions, demand surge, strategic stockpiling, bullish policy.
- direction 'down' if oversupply, production expansion, demand contraction, price cap, bearish policy.
- use 'uncertain' if mixed signals or insufficient detail.
- drivers: at most 5 concise lowercase phrases.
- reasoning: <= 240 chars.
No extra text.`;

    const user = `Article context:\nTitle: ${article.title}\nSource: ${article.source}\nPublished: ${article.publishedAt}\nText:\n"""\n${truncate(text, 1800)}\n"""`;

    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.15,
      });
    } catch (e: any) {
      if (isTlsIssuerError(e)) {
        return { direction: 'uncertain', confidence: 0.1, drivers: [], reasoning: 'tls_error' };
      }
      return { direction: 'uncertain', confidence: 0.1, drivers: [], reasoning: 'openai_error' };
    }

    const content = completion.choices?.[0]?.message?.content ?? '';
    const jsonText = extractJson(content);
    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch { return { direction: 'uncertain', confidence: 0.2, drivers: [], reasoning: 'parse_error' }; }

    const direction: RareEarthPriceImpact['direction'] = ['up','down','uncertain'].includes(parsed.direction) ? parsed.direction : 'uncertain';
    const confidence = clamp01(Number(parsed.confidence ?? 0.5));
    const drivers = Array.isArray(parsed.drivers) ? parsed.drivers.filter((d: any) => typeof d === 'string').slice(0,5) : [];
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0,240) : undefined;
    return { direction, confidence, drivers, reasoning };
  }

  /**
   * Produce an aggregated automotive-focused narrative and metrics from per-article structured results.
   * Input should be an array of objects: { relevance, classification, priceImpact }.
   */
  public async summarizeAggregate(items: Array<{ relevance: RareEarthRelevance; classification: Classification; priceImpact: RareEarthPriceImpact }>, totalFetched: number): Promise<AggregatedSummary> {
    if (!this.client) {
      return this.buildFallbackAggregate(items, totalFetched);
    }
    if (!items.length) {
      return this.buildFallbackAggregate(items, totalFetched);
    }
    // Prepare compact JSON payload for model
    const compact = items.slice(0, 60).map(i => ({
      cat: i.relevance.category,
      pc: i.priceImpact.direction,
      pd: i.priceImpact.drivers,
      sc: i.classification.sentiment
    }));

  const system = `You aggregate structured rare earth automotive article analytics.
You will receive arrays of compact objects with keys: cat (category), pc (price direction), pd (drivers[]), sc (sentiment).
Return ONLY JSON with keys:
priceImpactDistribution { up, down, uncertain }, sentimentDistribution { bullish, bearish, neutral }, dominantDrivers (string[] <=8 lowercase), narrative (<=420 chars, concise, no hype), suggestion (string <=140 chars).
Suggestion rules:
- suggestion starts with BUY / HOLD / SELL (uppercase) then a colon and brief rationale.
- Use BUY if strong bullish drivers AND priceImpactDistribution.up dominates and sentiment bullish > bearish.
- Use SELL if bearish drivers dominate AND down > up AND bearish > bullish.
- Otherwise use HOLD.
- Always append a disclaimer: "(informational, not financial advice)".
No lists of articles, focus on synthesized themes for automotive industry (EV motors, batteries).`;

    const user = `Data: ${JSON.stringify(compact)}`;
    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.25,
      });
    } catch (e: any) {
      if (isTlsIssuerError(e)) return this.buildFallbackAggregate(items, totalFetched);
      return this.buildFallbackAggregate(items, totalFetched);
    }
    const content = completion.choices?.[0]?.message?.content ?? '';
    const jsonText = extractJson(content);
    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch { return this.buildFallbackAggregate(items, totalFetched); }

    const aggBase = this.computeBaseMetrics(items, totalFetched);
    const pid = parsed.priceImpactDistribution || {}; 
    const sd = parsed.sentimentDistribution || {}; 
    const drivers = Array.isArray(parsed.dominantDrivers) ? parsed.dominantDrivers.filter((d: any)=> typeof d === 'string').map((d: string)=> d.toLowerCase()).slice(0,8) : [];
    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative.slice(0, 420) : 'No narrative';
    return { ...aggBase,
      priceImpactDistribution: {
        up: Number(pid.up) || 0,
        down: Number(pid.down) || 0,
        uncertain: Number(pid.uncertain) || 0
      },
      sentimentDistribution: {
        bullish: Number(sd.bullish) || 0,
        bearish: Number(sd.bearish) || 0,
        neutral: Number(sd.neutral) || 0
      },
      dominantDrivers: drivers,
      narrative,
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion.slice(0,140) : this.inferFallbackSuggestion(aggBase)
    };
  }

  private computeBaseMetrics(items: Array<{ relevance: RareEarthRelevance; classification: Classification; priceImpact: RareEarthPriceImpact }>, totalFetched: number) {
    const totalRelevant = items.length;
    const magnetCount = items.filter(i => i.relevance.category === 'magnet').length;
    const batteryCount = items.filter(i => i.relevance.category === 'battery').length;
    const mixedCount = items.filter(i => i.relevance.category === 'mixed').length;
    const otherCount = items.filter(i => i.relevance.category === 'other').length;
    const avgRelevanceConfidence = totalRelevant ? items.reduce((s,i)=> s + i.relevance.confidence,0)/totalRelevant : 0;
    const avgSentimentConfidence = totalRelevant ? items.reduce((s,i)=> s + i.classification.confidence,0)/totalRelevant : 0;
    const avgPriceImpactConfidence = totalRelevant ? items.reduce((s,i)=> s + i.priceImpact.confidence,0)/totalRelevant : 0;
    const priceImpactDistribution = {
      up: items.filter(i=> i.priceImpact.direction==='up').length,
      down: items.filter(i=> i.priceImpact.direction==='down').length,
      uncertain: items.filter(i=> i.priceImpact.direction==='uncertain').length
    };
    const sentimentDistribution = {
      bullish: items.filter(i=> i.classification.sentiment==='bullish').length,
      bearish: items.filter(i=> i.classification.sentiment==='bearish').length,
      neutral: items.filter(i=> i.classification.sentiment==='neutral').length
    };
    return {
      totalArticles: totalFetched,
      totalRelevant,
      magnetCount,
      batteryCount,
      mixedCount,
      otherCount,
      avgRelevanceConfidence,
      avgSentimentConfidence,
      avgPriceImpactConfidence,
      priceImpactDistribution,
      sentimentDistribution,
      dominantDrivers: [] as string[],
      narrative: ''
    } as AggregatedSummary;
  }

  private buildFallbackAggregate(items: Array<{ relevance: RareEarthRelevance; classification: Classification; priceImpact: RareEarthPriceImpact }>, totalFetched: number): AggregatedSummary {
    const base = this.computeBaseMetrics(items, totalFetched);
    return {
      ...base,
      dominantDrivers: [],
      narrative: items.length ? 'Automotive rare earth activity observed; AI summary unavailable.' : 'No relevant automotive rare earth articles found.',
      suggestion: this.inferFallbackSuggestion(base)
    };
  }

  private inferFallbackSuggestion(base: AggregatedSummary): string {
    // Simple heuristic: majority up & bullish => BUY, majority down & bearish => SELL else HOLD.
    const { priceImpactDistribution: pid, sentimentDistribution: sd } = base;
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (pid.up > pid.down && sd.bullish > sd.bearish && pid.up >= (pid.down + pid.uncertain)) action = 'BUY';
    else if (pid.down > pid.up && sd.bearish > sd.bullish && pid.down >= (pid.up + pid.uncertain)) action = 'SELL';
    return `${action}: heuristic summary based on current distributions (informational, not financial advice)`;
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
