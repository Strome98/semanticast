import { AnalyzeInput, Classification } from "../types";
import { OpenAIService } from "../services/OpenAIService";

export class IronNewsAnalyzer {
    constructor(private readonly ai: OpenAIService) {}

    public async analyze(source: AnalyzeInput): Promise<Classification> {
        if (this.ai.enabled) {
            try {
                return await this.ai.classifyNews(source);
            } catch (e) {
                // fallthrough to a naive baseline
            }
        }
        return naiveBaseline(source.headline);
    }
}

function naiveBaseline(text: string): Classification {
    const t = text.toLowerCase();
    const bull = ["surge", "rally", "record", "higher", "growth", "upgrade"].some(w => t.includes(w));
    const bear = ["plunge", "drop", "miss", "lower", "fraud", "downgrade"].some(w => t.includes(w));
    if (bull && !bear) return { sentiment: 'bullish', impact: 'up', confidence: 0.7 };
    if (bear && !bull) return { sentiment: 'bearish', impact: 'down', confidence: 0.7 };
    return { sentiment: 'neutral', impact: 'flat', confidence: 0.4 };
}