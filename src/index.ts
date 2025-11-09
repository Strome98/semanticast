import { IronNewsAnalyzer } from "./classifiers/IronNewsAnalyzer";
import { RareEarthMetalAnalyzer } from "./classifiers/RareEarthMetalAnalyzer";
import { ServerContext } from "./common/ServerContext";
import { NewsApiFetcher } from "./fetchers/NewsApiFetcher";
import { RareEarthMetalPredictor } from "./predictors/RareEarthMetalPredictor";
import { OpenAIService } from "./services/OpenAIService";
import { Article, AggregatedSummary } from "./types";
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { getConfig } from "./config";

async function main() {
    console.log('— — —');
    console.log('SemantiCast');
    console.log('Predicting prices from semantic analysis of news and classifying future impact.');
    console.log('— — —');
    
  const cfg = getConfig();
  const ai = new OpenAIService(cfg.openAiKey);
  const ctx: ServerContext = { ai };

  const newsApiFetcher = cfg.newsApiKey ? new NewsApiFetcher(cfg.newsApiKey) : null;
  const ironNewsAnalyzer = new IronNewsAnalyzer(ai);
  const rareEarthMetalAnalyzer = new RareEarthMetalAnalyzer(ai);
  const rareEarthMetalPredictor = new RareEarthMetalPredictor();

  if (!newsApiFetcher) {
    console.warn('NEWS_API_KEY not set; skipping fetch. Create a .env file with NEWS_API_KEY=... to enable fetching.');
    return;
  }

  // Simple pipeline prototype: fetch -> relevance -> sentiment classification
  const query = newsApiFetcher.buildRareEarthQuery([], true);
  const articles: Article[] = await newsApiFetcher.fetchAllPages(query, { pageSize: 50, pageLimit: 2 });
  console.log(`Fetched ${articles.length} articles.`);

  const results: Array<{ article: Article; relevance: import('./types').RareEarthRelevance; classification: import('./types').Classification; priceImpact: import('./types').RareEarthPriceImpact }> = [];
  let processed = 0;
  const startedAt = Date.now();
  for (const a of articles) {
    processed++;
    if (processed % 10 === 1) {
      console.log(`[progress] Processing article ${processed}/${articles.length}`);
    }
  let relevance: import('./types').RareEarthRelevance = { relevant: false, confidence: 0, matchedTerms: [], rationale: 'ai_disabled', automotiveRelevant: false, automotiveContextTerms: [], category: 'other', usage: undefined };
    if (ai.enabled) {
      try {
        relevance = await ai.assessRareEarthRelevance(a);
      } catch (e) {
        console.warn(`[warn] Relevance assessment failed for article id=${a.id}: ${(e as Error).message}`);
        continue; // skip on failure
      }
    }
  if (!relevance.relevant || !relevance.automotiveRelevant) continue; // filter non-relevant or non-automotive
  const classification = await ironNewsAnalyzer.analyze({ headline: a.title, body: a.description || a.content, source: a.source, publishedAt: a.publishedAt });
  const priceImpact = await rareEarthMetalAnalyzer.priceImpact(a);
  results.push({ article: a, relevance, classification, priceImpact });
  }

  const durationMs = Date.now() - startedAt;
  // Aggregate summary via AI (single response)
  let aggregate: AggregatedSummary;
  try {
    aggregate = await ai.summarizeAggregate(results.map(r => ({ relevance: r.relevance, classification: r.classification, priceImpact: r.priceImpact })), articles.length);
  } catch {
  aggregate = { totalArticles: articles.length, totalRelevant: results.length, magnetCount:0,batteryCount:0,mixedCount:0,otherCount:0,avgRelevanceConfidence:0,avgSentimentConfidence:0,avgPriceImpactConfidence:0,priceImpactDistribution:{up:0,down:0,uncertain:0},sentimentDistribution:{bullish:0,bearish:0,neutral:0},dominantDrivers:[], narrative:'aggregate_error', suggestion:'HOLD: aggregate error fallback (informational, not financial advice)'};
  }

  console.log('— — —');
  console.log('Automotive Rare Earth Aggregate Summary');
  console.log(`Fetched: ${aggregate.totalArticles}`);
  console.log(`Relevant (automotive): ${aggregate.totalRelevant}`);
  console.log(`Categories magnet=${aggregate.magnetCount} battery=${aggregate.batteryCount} mixed=${aggregate.mixedCount} other=${aggregate.otherCount}`);
  console.log(`Price impact distribution: up=${aggregate.priceImpactDistribution.up} down=${aggregate.priceImpactDistribution.down} uncertain=${aggregate.priceImpactDistribution.uncertain}`);
  console.log(`Sentiment distribution: bullish=${aggregate.sentimentDistribution.bullish} bearish=${aggregate.sentimentDistribution.bearish} neutral=${aggregate.sentimentDistribution.neutral}`);
  console.log(`Avg relevance confidence: ${aggregate.avgRelevanceConfidence.toFixed(3)}`);
  console.log(`Avg sentiment confidence: ${aggregate.avgSentimentConfidence.toFixed(3)}`);
  console.log(`Avg price impact confidence: ${aggregate.avgPriceImpactConfidence.toFixed(3)}`);
  console.log(`Dominant drivers: ${aggregate.dominantDrivers.join(', ') || 'none'}`);
  // Clean narrative (remove accidental newlines / hyphen breaks from model)
  const cleanNarrative = aggregate.narrative.replace(/\n+/g,' ').replace(/\s{2,}/g,' ').replace(/-\s+/g,'-').trim();
  aggregate.narrative = cleanNarrative;
  console.log('Narrative:', cleanNarrative);
  console.log('Suggestion:', aggregate.suggestion);
  console.log(`Duration: ${(durationMs/1000).toFixed(2)}s`);
  console.log('— — —');

  // Persist aggregate summary
  try {
    const outDir = path.resolve(process.cwd(), 'output');
    mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'aggregate-summary.json');
    writeFileSync(filePath, JSON.stringify(aggregate, null, 2), 'utf-8');
    console.log(`[persist] Aggregate summary written to ${filePath}`);
  } catch (e) {
    console.warn('[persist] Failed to write aggregate summary:', (e as Error).message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
