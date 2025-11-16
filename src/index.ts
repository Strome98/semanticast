import { IronNewsAnalyzer } from "./classifiers/IronNewsAnalyzer";
import { RareEarthMetalAnalyzer } from "./classifiers/RareEarthMetalAnalyzer";
import { ServerContext } from "./common/ServerContext";
import { NewsApiFetcher } from "./fetchers/NewsApiFetcher";
import { RareEarthMetalPredictor } from "./predictors/RareEarthMetalPredictor";
import { OpenAIService } from "./services/OpenAIService";
import { Article, AggregatedSummary } from "./types";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import path from "path";
import { getConfig } from "./config";

async function main() {
  console.log("— — —");
  console.log("SemantiCast");
  console.log(
    "Predicting prices from semantic analysis of news and classifying future impact."
  );
  console.log("— — —");

  const cfg = getConfig();
  const ai = new OpenAIService(cfg.openAiKey);
  const ctx: ServerContext = { ai };

  const newsApiFetcher = cfg.newsApiKey
    ? new NewsApiFetcher(cfg.newsApiKey)
    : null;
  const ironNewsAnalyzer = new IronNewsAnalyzer(ai);
  const rareEarthMetalAnalyzer = new RareEarthMetalAnalyzer(ai);
  const rareEarthMetalPredictor = new RareEarthMetalPredictor();

  // Check if we should skip fetching and use existing aggregate summary
  if (cfg.skipFetch) {
    console.log("[mode] SKIP_FETCH=true, loading latest aggregate summary...");
    const aggregate = loadLatestAggregateSummary();
    if (!aggregate) {
      console.error(
        "[error] No existing aggregate summary found in output/ directory. Run without SKIP_FETCH first."
      );
      return;
    }
    console.log(
      `[loaded] Using aggregate summary with ${aggregate.totalRelevant} relevant articles`
    );
    await generatePredictionOnly(aggregate, rareEarthMetalPredictor);
    return;
  }

  if (!newsApiFetcher) {
    console.warn(
      "NEWS_API_KEY not set; skipping fetch. Create a .env file with NEWS_API_KEY=... to enable fetching."
    );
    return;
  }

  // Maximize free tier by fetching multiple targeted queries (100 articles each)
  const queries = [
    // Query 1: General rare earth + automotive
    newsApiFetcher.buildRareEarthQuery([], true),
    // Query 2: Battery-specific metals + EV
    '(lithium OR cobalt OR nickel OR manganese OR graphite) AND (battery OR "battery pack" OR EV OR "electric vehicle" OR gigafactory)',
    // Query 3: Magnet-specific metals + motors
    '(neodymium OR praseodymium OR dysprosium OR terbium OR samarium) AND (magnet OR motor OR "traction motor" OR "permanent magnet" OR drivetrain)',
    // Query 4: Supply chain focus
    '("rare earth" OR neodymium OR lithium) AND (supply OR export OR mining OR refining OR China OR shortage)',
  ];

  const allArticles: Article[] = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    console.log(`Fetching query ${queryIndex + 1}/${queries.length}...`);
    const batch = await newsApiFetcher.fetchAllPages(queries[queryIndex], {
      pageSize: 100,
      pageLimit: 1, // 1 page = 100 articles per query
    });
    allArticles.push(...batch);
    console.log(`  → Fetched ${batch.length} articles`);
  }

  // Deduplicate by URL across all queries
  const articleMap = new Map<string, Article>();
  allArticles.forEach((article) => articleMap.set(article.url, article));
  const articles = [...articleMap.values()];
  console.log(`Total unique articles: ${articles.length}`);

  const results: Array<{
    article: Article;
    relevance: import("./types").RareEarthRelevance;
    classification: import("./types").Classification;
    priceImpact: import("./types").RareEarthPriceImpact;
  }> = [];

  const startedAt = Date.now();
  const BATCH_SIZE = 10; // Process 10 articles in parallel

  console.log(
    `Processing ${articles.length} articles in batches of ${BATCH_SIZE}...`
  );

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    console.log(
      `[progress] Processing batch ${
        Math.floor(i / BATCH_SIZE) + 1
      }/${Math.ceil(articles.length / BATCH_SIZE)} (articles ${
        i + 1
      }-${Math.min(i + BATCH_SIZE, articles.length)})`
    );

    const batchPromises = batch.map(async (article) => {
      let relevance: import("./types").RareEarthRelevance = {
        relevant: false,
        confidence: 0,
        matchedTerms: [],
        rationale: "ai_disabled",
        automotiveRelevant: false,
        automotiveContextTerms: [],
        category: "other",
        usage: undefined,
      };

      if (ai.enabled) {
        try {
          relevance = await ai.assessRareEarthRelevance(article);
        } catch (e) {
          console.warn(
            `[warn] Relevance assessment failed for article: ${
              (e as Error).message
            }`
          );
          return null; // skip on failure
        }
      }

      if (!relevance.relevant || !relevance.automotiveRelevant) return null;

      // Process classification and price impact in parallel
      const [classification, priceImpact] = await Promise.all([
        ironNewsAnalyzer.analyze({
          headline: article.title,
          body: article.description || article.content,
          source: article.source,
          publishedAt: article.publishedAt,
        }),
        rareEarthMetalAnalyzer.priceImpact(article),
      ]);

      return { article, relevance, classification, priceImpact };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...(batchResults.filter((r) => r !== null) as typeof results));
  }

  const durationMs = Date.now() - startedAt;
  // Aggregate summary via AI (single response)
  let aggregate: AggregatedSummary;
  try {
    aggregate = await ai.summarizeAggregate(
      results.map((r) => ({
        relevance: r.relevance,
        classification: r.classification,
        priceImpact: r.priceImpact,
      })),
      articles.length
    );
  } catch {
    aggregate = {
      totalArticles: articles.length,
      totalRelevant: results.length,
      magnetCount: 0,
      batteryCount: 0,
      mixedCount: 0,
      otherCount: 0,
      avgRelevanceConfidence: 0,
      avgSentimentConfidence: 0,
      avgPriceImpactConfidence: 0,
      priceImpactDistribution: { up: 0, down: 0, uncertain: 0 },
      sentimentDistribution: { bullish: 0, bearish: 0, neutral: 0 },
      dominantDrivers: [],
      narrative: "aggregate_error",
      suggestion:
        "HOLD: aggregate error fallback (informational, not financial advice)",
    };
  }

  // Generate 14-day price prediction
  const pricePrediction = rareEarthMetalPredictor.predict(aggregate);
  aggregate.pricePrediction = pricePrediction;

  console.log("— — —");
  console.log("Automotive Rare Earth Aggregate Summary");
  console.log(`Fetched: ${aggregate.totalArticles}`);
  console.log(`Relevant (automotive): ${aggregate.totalRelevant}`);
  console.log(
    `Categories magnet=${aggregate.magnetCount} battery=${aggregate.batteryCount} mixed=${aggregate.mixedCount} other=${aggregate.otherCount}`
  );
  console.log(
    `Price impact distribution: up=${aggregate.priceImpactDistribution.up} down=${aggregate.priceImpactDistribution.down} uncertain=${aggregate.priceImpactDistribution.uncertain}`
  );
  console.log(
    `Sentiment distribution: bullish=${aggregate.sentimentDistribution.bullish} bearish=${aggregate.sentimentDistribution.bearish} neutral=${aggregate.sentimentDistribution.neutral}`
  );
  console.log(
    `Avg relevance confidence: ${aggregate.avgRelevanceConfidence.toFixed(3)}`
  );
  console.log(
    `Avg sentiment confidence: ${aggregate.avgSentimentConfidence.toFixed(3)}`
  );
  console.log(
    `Avg price impact confidence: ${aggregate.avgPriceImpactConfidence.toFixed(
      3
    )}`
  );
  console.log(
    `Dominant drivers: ${aggregate.dominantDrivers.join(", ") || "none"}`
  );
  console.log("— — —");
  console.log("14-Day Price Prediction");
  console.log(
    `Current basket price: $${pricePrediction.currentBasketPrice}/kg`
  );
  console.log(
    `Predicted change: ${
      pricePrediction.predictedChangePercent > 0 ? "+" : ""
    }${pricePrediction.predictedChangePercent}% ($${
      pricePrediction.predictedChangeUSD > 0 ? "+" : ""
    }${pricePrediction.predictedChangeUSD}/kg)`
  );
  console.log(`Price target: $${pricePrediction.priceTarget}/kg`);
  console.log(
    `Prediction confidence: ${(pricePrediction.confidence * 100).toFixed(1)}%`
  );
  console.log(
    `Baseline volatility: ${pricePrediction.baselineVolatility}% | News multiplier: ${pricePrediction.newsImpactMultiplier}x`
  );
  // Clean narrative (remove accidental newlines / hyphen breaks from model)
  const cleanNarrative = aggregate.narrative
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/-\s+/g, "-")
    .trim();
  aggregate.narrative = cleanNarrative;
  console.log("Narrative:", cleanNarrative);
  console.log("Suggestion:", aggregate.suggestion);
  console.log(`Duration: ${(durationMs / 1000).toFixed(2)}s`);
  console.log("— — —");

  // Persist aggregate summary
  try {
    const outDir = path.resolve(process.cwd(), "output");
    mkdirSync(outDir, { recursive: true });
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;
    const filePath = path.join(outDir, `aggregate-summary-${dateStr}.json`);
    writeFileSync(filePath, JSON.stringify(aggregate, null, 2), "utf-8");
    console.log(`[persist] Aggregate summary written to ${filePath}`);
  } catch (e) {
    console.warn(
      "[persist] Failed to write aggregate summary:",
      (e as Error).message
    );
  }
}

/**
 * Load the most recent aggregate summary JSON file from output/ directory
 */
function loadLatestAggregateSummary(): AggregatedSummary | null {
  try {
    const outDir = path.resolve(process.cwd(), "output");
    if (!statSync(outDir).isDirectory()) {
      return null;
    }

    const files = readdirSync(outDir)
      .filter((f) => f.startsWith("aggregate-summary-") && f.endsWith(".json"))
      .map((f) => ({
        name: f,
        path: path.join(outDir, f),
        mtime: statSync(path.join(outDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (files.length === 0) {
      return null;
    }

    const latestFile = files[0];
    console.log(`[loading] ${latestFile.name}`);
    const content = readFileSync(latestFile.path, "utf-8");
    return JSON.parse(content) as AggregatedSummary;
  } catch (e) {
    console.error(
      "[error] Failed to load aggregate summary:",
      (e as Error).message
    );
    return null;
  }
}

/**
 * Generate prediction only mode - uses existing aggregate summary
 */
async function generatePredictionOnly(
  aggregate: AggregatedSummary,
  predictor: RareEarthMetalPredictor
) {
  console.log("— — —");
  console.log("Automotive Rare Earth Aggregate Summary (from file)");
  console.log(`Fetched: ${aggregate.totalArticles}`);
  console.log(`Relevant (automotive): ${aggregate.totalRelevant}`);
  console.log(
    `Categories magnet=${aggregate.magnetCount} battery=${aggregate.batteryCount} mixed=${aggregate.mixedCount} other=${aggregate.otherCount}`
  );
  console.log(
    `Price impact distribution: up=${aggregate.priceImpactDistribution.up} down=${aggregate.priceImpactDistribution.down} uncertain=${aggregate.priceImpactDistribution.uncertain}`
  );
  console.log(
    `Sentiment distribution: bullish=${aggregate.sentimentDistribution.bullish} bearish=${aggregate.sentimentDistribution.bearish} neutral=${aggregate.sentimentDistribution.neutral}`
  );
  console.log(
    `Dominant drivers: ${aggregate.dominantDrivers.join(", ") || "none"}`
  );

  // Generate fresh prediction
  const pricePrediction = predictor.predict(aggregate);

  console.log("— — —");
  console.log("14-Day Price Prediction (Regenerated)");
  console.log(
    `Current basket price: $${pricePrediction.currentBasketPrice}/kg`
  );
  console.log(
    `Predicted change: ${
      pricePrediction.predictedChangePercent > 0 ? "+" : ""
    }${pricePrediction.predictedChangePercent}% ($${
      pricePrediction.predictedChangeUSD > 0 ? "+" : ""
    }${pricePrediction.predictedChangeUSD}/kg)`
  );
  console.log(`Price target: $${pricePrediction.priceTarget}/kg`);
  console.log(
    `Prediction confidence: ${(pricePrediction.confidence * 100).toFixed(1)}%`
  );
  console.log(
    `Baseline volatility: ${pricePrediction.baselineVolatility}% | News multiplier: ${pricePrediction.newsImpactMultiplier}x`
  );
  console.log(`Reasoning: ${pricePrediction.reasoning}`);
  console.log("— — —");
  console.log(`Suggestion: ${aggregate.suggestion}`);
  console.log("— — —");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
