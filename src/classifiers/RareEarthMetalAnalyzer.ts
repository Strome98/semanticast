import { AnalyzeInput, Classification } from "../types";
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
        return { sentiment: 'neutral', impact: 'flat', confidence: 0.3 };
    }
}