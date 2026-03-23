import { AggregatedSummary, PricePrediction, PriceDataSummary } from "../types";

/**
 * Predicts rare earth metal price changes over next 14 days.
 * Combines historical basket volatility (from PriceDataSummary) with news
 * sentiment analysis (from AggregatedSummary).
 *
 * When no PriceDataSummary is supplied the predictor falls back to static
 * reference values so that existing callers remain functional.
 */
export class RareEarthMetalPredictor {
  // Static fallback values — used only when no live price data is available.
  // Originally sourced from typical 2023-era market estimates.
  private readonly FALLBACK_14DAY_VOLATILITY = 3.2; // %
  private readonly FALLBACK_BASKET_PRICE = 95;       // USD/kg

  /**
   * Generate a 14-day price prediction.
   *
   * @param aggregate  Aggregated news-analysis summary (sentiment, impact, drivers)
   * @param priceData  Optional real-market price summary from MetalPriceFetcher.
   *                   When provided, replaces static fallback constants.
   */
  public predict(
    aggregate: AggregatedSummary,
    priceData?: PriceDataSummary | null,
  ): PricePrediction {
    // Resolve basket price and volatility from live data or static fallback
    const basketPrice        = priceData?.basketPrice                       ?? this.FALLBACK_BASKET_PRICE;
    const baselineVolatility = priceData?.statistics.rollingVolatility14d   ?? this.FALLBACK_14DAY_VOLATILITY;
    const priceDataSource: PricePrediction['priceDataSource'] =
      priceData?.source === 'metals-api' ? 'metals-api' :
      priceData?.source === 'seed'       ? 'seed'       : 'static';

    // Calculate news sentiment score (-1 to +1)
    const sentimentScore = this.calculateSentimentScore(aggregate);

    // Calculate price impact score (-1 to +1)
    const priceImpactScore = this.calculatePriceImpactScore(aggregate);

    // Combine scores with weights (sentiment 40%, price impact 60%)
    const combinedScore = sentimentScore * 0.4 + priceImpactScore * 0.6;

    // Calculate news impact multiplier (0.5 to 2.0)
    // Negative news dampens volatility, positive news amplifies it
    const newsImpactMultiplier = 1.0 + combinedScore * 0.8;

    // Calculate predicted change percentage using real baseline volatility
    const predictedChangePercent =
      baselineVolatility * newsImpactMultiplier * Math.sign(combinedScore);

    // Calculate USD change based on real basket price
    const predictedChangeUSD = (basketPrice * predictedChangePercent) / 100;

    // Calculate price target
    const priceTarget = basketPrice + predictedChangeUSD;

    // Calculate confidence based on article count and average confidences
    const confidence = this.calculatePredictionConfidence(aggregate);

    // Generate reasoning
    const reasoning = this.generateReasoning(
      aggregate,
      sentimentScore,
      priceImpactScore,
      combinedScore,
      priceData,
    );

    return {
      predictedChangePercent: Math.round(predictedChangePercent * 100) / 100,
      predictedChangeUSD:     Math.round(predictedChangeUSD * 100) / 100,
      confidence:             Math.round(confidence * 1000) / 1000,
      baselineVolatility,
      newsImpactMultiplier:   Math.round(newsImpactMultiplier * 100) / 100,
      priceTarget:            Math.round(priceTarget * 100) / 100,
      currentBasketPrice:     basketPrice,
      reasoning,
      priceDataSource,
    };
  }

  /**
   * Calculate sentiment score from -1 (very bearish) to +1 (very bullish)
   */
  private calculateSentimentScore(aggregate: AggregatedSummary): number {
    const { bullish, bearish, neutral } = aggregate.sentimentDistribution;
    const total = bullish + bearish + neutral;

    if (total === 0) return 0;

    // Bullish = +1, Bearish = -1, Neutral = 0
    const score = (bullish - bearish) / total;
    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Calculate price impact score from -1 (down) to +1 (up)
   */
  private calculatePriceImpactScore(aggregate: AggregatedSummary): number {
    const { up, down, uncertain } = aggregate.priceImpactDistribution;
    const total = up + down + uncertain;

    if (total === 0) return 0;

    // Up = +1, Down = -1, Uncertain = 0
    const score = (up - down) / total;
    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Calculate overall prediction confidence based on data quality
   */
  private calculatePredictionConfidence(aggregate: AggregatedSummary): number {
    // Start with average of AI confidences
    const avgConfidence =
      (aggregate.avgRelevanceConfidence +
        aggregate.avgSentimentConfidence +
        aggregate.avgPriceImpactConfidence) /
      3;

    // Apply article count factor (more articles = higher confidence)
    // Diminishing returns after 30 articles
    const articleFactor = Math.min(1, aggregate.totalRelevant / 30);

    // Penalize if too many "uncertain" signals
    const uncertainPenalty =
      1 - aggregate.priceImpactDistribution.uncertain / aggregate.totalRelevant;

    return avgConfidence * 0.5 + articleFactor * 0.3 + uncertainPenalty * 0.2;
  }

  /**
   * Generate human-readable reasoning for the prediction
   */
  private generateReasoning(
    aggregate: AggregatedSummary,
    sentimentScore: number,
    priceImpactScore: number,
    combinedScore: number,
    priceData?: PriceDataSummary | null,
  ): string {
    const direction =
      combinedScore > 0.1
        ? "upward"
        : combinedScore < -0.1
        ? "downward"
        : "stable";
    const strength =
      Math.abs(combinedScore) > 0.5
        ? "strong"
        : Math.abs(combinedScore) > 0.2
        ? "moderate"
        : "weak";

    const sentimentDesc =
      sentimentScore > 0.1
        ? "bullish sentiment"
        : sentimentScore < -0.1
        ? "bearish sentiment"
        : "neutral sentiment";

    const impactDesc =
      priceImpactScore > 0.1
        ? "supply risks"
        : priceImpactScore < -0.1
        ? "oversupply signals"
        : "balanced supply-demand";

    const priceNote =
      priceData?.source === 'metals-api'
        ? `Real-time Metals-API data (${priceData.periodEnd})`
        : priceData?.source === 'seed'
        ? `Seed data covering ${priceData.periodStart} to ${priceData.periodEnd}`
        : 'Static baseline (no price data available)';

    return `${
      strength.charAt(0).toUpperCase() + strength.slice(1)
    } ${direction} pressure driven by ${sentimentDesc} and ${impactDesc}. Based on ${
      aggregate.totalRelevant
    } automotive-relevant articles (${aggregate.magnetCount} magnet, ${
      aggregate.batteryCount
    } battery). Key drivers: ${aggregate.dominantDrivers
      .slice(0, 3)
      .join(", ")}. Price source: ${priceNote}.`;
  }
}
