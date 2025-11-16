import express from "express";
import cors from "cors";
import path from "path";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { AggregatedSummary, PricePrediction } from "./types";
import { RareEarthMetalPredictor } from "./predictors/RareEarthMetalPredictor";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

/**
 * Load the most recent aggregate summary JSON file
 */
function loadLatestAggregateSummary(): AggregatedSummary | null {
  try {
    const outDir = path.resolve(process.cwd(), "output");
    if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
      return null;
    }

    const files = readdirSync(outDir)
      .filter((filename) => filename.startsWith("aggregate-summary-") && filename.endsWith(".json"))
      .map((filename) => ({
        name: filename,
        path: path.join(outDir, filename),
        mtime: statSync(path.join(outDir, filename)).mtime,
      }))
      .sort((fileA, fileB) => fileB.mtime.getTime() - fileA.mtime.getTime());

    if (files.length === 0) {
      return null;
    }

    const latestFile = files[0];
    const content = readFileSync(latestFile.path, "utf-8");
    return JSON.parse(content) as AggregatedSummary;
  } catch (error) {
    console.error("Failed to load aggregate summary:", (error as Error).message);
    return null;
  }
}

/**
 * Generate historical price data (simulated for last 14 days)
 * In production, this should come from a real price API
 */
function generateHistoricalPrices(
  currentPrice: number,
  volatility: number
): Array<{ date: string; price: number }> {
  const prices: Array<{ date: string; price: number }> = [];
  const today = new Date();

  // Generate 14 days of historical data with random walk
  let price = currentPrice;
  for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    // Random walk with mean reversion
    const change = (Math.random() - 0.5) * (volatility / 100) * 2;
    price = price * (1 + change);
    prices.push({
      date: date.toISOString().split("T")[0],
      price: Math.round(price * 100) / 100,
    });
  }

  // Add today's price
  prices.push({
    date: today.toISOString().split("T")[0],
    price: currentPrice,
  });

  return prices;
}

/**
 * Generate future price predictions for next 14 days
 */
function generateFuturePrices(
  currentPrice: number,
  prediction: PricePrediction
): Array<{ date: string; price: number; isPrediction: boolean }> {
  const prices: Array<{ date: string; price: number; isPrediction: boolean }> =
    [];
  const today = new Date();

  // Linear interpolation from current price to target price over 14 days
  const priceChange = prediction.predictedChangeUSD;
  const dailyChange = priceChange / 14;

  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const date = new Date(today);
    date.setDate(date.getDate() + dayOffset);
    const price = currentPrice + dailyChange * dayOffset;
    prices.push({
      date: date.toISOString().split("T")[0],
      price: Math.round(price * 100) / 100,
      isPrediction: true,
    });
  }

  return prices;
}

// API endpoint to get summary data with price chart data
app.get("/api/summary", (req, res) => {
  const summary = loadLatestAggregateSummary();

  if (!summary) {
    return res.status(404).json({
      error: "No aggregate summary found. Run the analysis first.",
    });
  }

  // Generate prediction if not present in the summary
  let prediction: PricePrediction;
  if (!summary.pricePrediction) {
    const predictor = new RareEarthMetalPredictor();
    prediction = predictor.predict(summary);
    summary.pricePrediction = prediction;
  } else {
    prediction = summary.pricePrediction;
  }

  // Generate historical and future price data
  const historicalPrices = generateHistoricalPrices(
    prediction.currentBasketPrice,
    prediction.baselineVolatility
  );

  const futurePrices = generateFuturePrices(
    prediction.currentBasketPrice,
    prediction
  );

  // Combine all price data
  const allPrices = [
    ...historicalPrices.map((priceData) => ({ ...priceData, isPrediction: false })),
    ...futurePrices,
  ];

  res.json({
    summary,
    chartData: {
      prices: allPrices,
      currentPrice: prediction.currentBasketPrice,
      predictedPrice: prediction.priceTarget,
      todayDate: new Date().toISOString().split("T")[0],
    },
  });
});

// Serve the frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`SemantiCast Web Server running at http://localhost:${PORT}`);
  console.log(`Open your browser to view the dashboard`);
});
