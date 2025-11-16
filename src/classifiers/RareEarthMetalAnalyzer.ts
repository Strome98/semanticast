import {
  AnalyzeInput,
  Classification,
  Article,
  RareEarthPriceImpact,
} from "../types";
import { OpenAIService } from "../services/OpenAIService";

export class RareEarthMetalAnalyzer {
  constructor(private readonly ai: OpenAIService) {}

  public async analyze(source: AnalyzeInput): Promise<Classification> {
    if (this.ai.enabled) {
      try {
        return await this.ai.classifyNews(source);
      } catch (e) {
        // fallback
      }
    }
    return { sentiment: "neutral", impact: "flat", confidence: 0.3 };
  }

  /**
   * Determine expected price impact direction for a rare earth related article.
   */
  public async priceImpact(article: Article): Promise<RareEarthPriceImpact> {
    if (this.ai.enabled) {
      try {
        return await this.ai.assessRareEarthPriceImpact(article);
      } catch (e) {
        // swallow and return uncertain
      }
    }
    return {
      direction: "uncertain",
      confidence: 0.2,
      drivers: [],
      reasoning: "ai_disabled",
    };
  }
}
