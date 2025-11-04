import { IronNewsAnalyzer } from "./classifiers/IronNewsAnalyzer";
import { RareEarthMetalAnalyzer } from "./classifiers/RareEarthMetalAnalyzer";
import { ServerContext } from "./common/ServerContext";
import { NewsApiFetcher } from "./fetchers/NewsApiFetcher";
import { RareEarthMetalPredictor } from "./predictors/RareEarthMetalPredictor";

async function main() {
    console.log('— — —');
    console.log('SemantiCast');
    console.log('Predicting prices from semantic analysis of news and classifying future impact.');
    console.log('— — —');
    
    const ctx: ServerContext = {

    };

    const newsApiFetcher = new NewsApiFetcher();
    const ironNewsAnalyzer = new IronNewsAnalyzer();
    const rareEarthMetalAnalyzer = new RareEarthMetalAnalyzer();
    const rareEarthMetalPredictor = new RareEarthMetalPredictor();

    
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
