import { IronNewsAnalyzer } from "./classifiers/IronNewsAnalyzer";
import { RareEarthMetalAnalyzer } from "./classifiers/RareEarthMetalAnalyzer";
import { ServerContext } from "./common/ServerContext";
import { NewsApiFetcher } from "./fetchers/NewsApiFetcher";
import { RareEarthMetalPredictor } from "./predictors/RareEarthMetalPredictor";
import { OpenAIService } from "./services/OpenAIService";
import { Article } from "./types";
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
  const query = newsApiFetcher.buildRareEarthQuery();
  const articles: Article[] = await newsApiFetcher.fetchAllPages(query, { pageSize: 50, pageLimit: 2 });
  console.log(`Fetched ${articles.length} articles.`);

  const results = [];
  let processed = 0;
  const startedAt = Date.now();
  for (const a of articles) {
    processed++;
    if (processed % 10 === 1) {
      console.log(`[progress] Processing article ${processed}/${articles.length}`);
    }
    let relevance: import('./types').RareEarthRelevance = { relevant: false, confidence: 0, matchedTerms: [], rationale: 'ai_disabled' };
    if (ai.enabled) {
      try {
        relevance = await ai.assessRareEarthRelevance(a);
      } catch (e) {
        console.warn(`[warn] Relevance assessment failed for article id=${a.id}: ${(e as Error).message}`);
        continue; // skip on failure
      }
    }
    if (!relevance.relevant) continue; // filter non-relevant
    const classification = await ironNewsAnalyzer.analyze({ headline: a.title, body: a.description || a.content, source: a.source, publishedAt: a.publishedAt });
    results.push({ article: a, relevance, classification });
  }

  const durationMs = Date.now() - startedAt;
  console.log(`Relevant articles: ${results.length}`);
  for (const r of results) {
    console.log('—');
    console.log(r.article.title);
    console.log('Relevance:', r.relevance);
    console.log('Classification:', r.classification);
    console.log(r.article.url);
  }

  const avgSentimentConfidence = results.length
    ? (results.reduce((sum, r) => sum + r.classification.confidence, 0) / results.length)
    : 0;
  const avgRelevanceConfidence = results.length
    ? (results.reduce((sum, r) => sum + r.relevance.confidence, 0) / results.length)
    : 0;
  console.log('— — —');
  console.log('Pipeline summary');
  console.log(`Total fetched: ${articles.length}`);
  console.log(`Processed (attempted relevance): ${processed}`);
  console.log(`Relevant kept: ${results.length}`);
  console.log(`Avg relevance confidence: ${avgRelevanceConfidence.toFixed(3)}`);
  console.log(`Avg sentiment confidence: ${avgSentimentConfidence.toFixed(3)}`);
  console.log(`Duration: ${(durationMs/1000).toFixed(2)}s`);
  console.log('— — —');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
