import { AggregatedSummary, PricePrediction } from "../types";

/**
 * Predicts rare earth metal price changes over next 14 days
 * Combines historical volatility with news sentiment analysis
 */
export class RareEarthMetalPredictor {
  // Historical 14-day average price volatility for rare earth basket (%)
  // Based on typical market behavior - you should update this with real data
  private readonly BASELINE_14DAY_VOLATILITY = 3.2; // 3.2% average fluctuation

  // Reference price for rare earth basket in USD/kg (weighted average)
  // Neodymium oxide (~$70/kg), Praseodymium oxide (~$85/kg), Dysprosium oxide (~$320/kg)
  // Lithium carbonate (~$15/kg), Cobalt (~$35/kg)
  // Weighted basket approximation for automotive use case
  private readonly BASKET_REFERENCE_PRICE = 95; // USD per kg weighted basket

  /**
   * Generate 14-day price prediction based on aggregate news analysis
   * @param aggregate Aggregated summary from news analysis
   * @returns PricePrediction with expected price change
   */
  public predict(aggregate: AggregatedSummary): PricePrediction {
    // Calculate news sentiment score (-1 to +1)
    const sentimentScore = this.calculateSentimentScore(aggregate);

    // Calculate price impact score (-1 to +1)
    const priceImpactScore = this.calculatePriceImpactScore(aggregate);

    // Combine scores with weights (sentiment 40%, price impact 60%)
    const combinedScore = sentimentScore * 0.4 + priceImpactScore * 0.6;

    // Calculate news impact multiplier (0.5 to 2.0)
    // Negative news can dampen volatility, positive news can amplify it
    const newsImpactMultiplier = 1.0 + combinedScore * 0.8;

    // Calculate predicted change percentage
    const predictedChangePercent =
      this.BASELINE_14DAY_VOLATILITY *
      newsImpactMultiplier *
      Math.sign(combinedScore);

    // Calculate USD change
    const predictedChangeUSD =
      (this.BASKET_REFERENCE_PRICE * predictedChangePercent) / 100;

    // Calculate price target
    const priceTarget = this.BASKET_REFERENCE_PRICE + predictedChangeUSD;

    // Calculate confidence based on article count and average confidences
    const confidence = this.calculatePredictionConfidence(aggregate);

    // Generate reasoning
    const reasoning = this.generateReasoning(
      aggregate,
      sentimentScore,
      priceImpactScore,
      combinedScore
    );

    return {
      predictedChangePercent: Math.round(predictedChangePercent * 100) / 100,
      predictedChangeUSD: Math.round(predictedChangeUSD * 100) / 100,
      confidence: Math.round(confidence * 1000) / 1000,
      baselineVolatility: this.BASELINE_14DAY_VOLATILITY,
      newsImpactMultiplier: Math.round(newsImpactMultiplier * 100) / 100,
      priceTarget: Math.round(priceTarget * 100) / 100,
      currentBasketPrice: this.BASKET_REFERENCE_PRICE,
      reasoning,
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
    combinedScore: number
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

    return `${
      strength.charAt(0).toUpperCase() + strength.slice(1)
    } ${direction} pressure driven by ${sentimentDesc} and ${impactDesc}. Based on ${
      aggregate.totalRelevant
    } automotive-relevant articles (${aggregate.magnetCount} magnet, ${
      aggregate.batteryCount
    } battery). Key drivers: ${aggregate.dominantDrivers
      .slice(0, 3)
      .join(", ")}.`;
  }
}
