import path from 'path';
import { readFileSync } from 'fs';
import {
  MetalSymbol,
  MetalPriceHistory,
  PriceDataSummary,
  METAL_INFO,
} from '../types';
import { computeBasketPrice, computePriceStatistics } from '../statistics/priceStatistics';

// Shape of the bundled src/data/seed-prices.json file
interface SeedFile {
  source: 'seed';
  generatedAt: string;
  note: string;
  prices: Record<MetalSymbol, Array<{ date: string; priceUsd: number }>>;
}

const SYMBOLS: MetalSymbol[] = ['ND', 'PR', 'LI', 'CO'];
// Metals-API returns rates as "units of metal per 1 USD" (fixer.io convention).
// Invert to obtain USD/kg: priceUsd = 1 / rate
const RATE_TO_USD_PER_KG = (rate: number) => Math.round((1 / rate) * 100) / 100;

export class MetalPriceFetcher {
  constructor(private readonly apiKey?: string) {}

  /**
   * Fetch historical price data for the last `daysBack` trading days.
   *
   * – If METALS_API_KEY is configured: queries metals-api.com for each
   *   business day and computes basket statistics from the responses.
   * – Otherwise: loads the bundled seed-prices.json (offline / demo mode).
   *
   * @param daysBack Number of calendar days to look back (weekends skipped)
   */
  public async fetchPriceData(daysBack = 45): Promise<PriceDataSummary> {
    if (!this.apiKey) {
      console.log('[price] No METALS_API_KEY — using bundled seed data');
      return this.loadSeedData();
    }

    const dates = this.buildTradingDays(daysBack);
    console.log(`[price] Fetching ${dates.length} trading days from Metals-API...`);

    const rawPrices = new Map<string, Record<MetalSymbol, number>>();
    const BATCH_SIZE = 5; // concurrent requests (free tier: ~50 req/month)

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const chunk = dates.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(dates.length / BATCH_SIZE);
      console.log(`[price]   batch ${batchNum}/${totalBatches} (${chunk[0]} … ${chunk[chunk.length - 1]})`);

      const results = await Promise.all(
        chunk.map(date => this.fetchDateFromApi(date)),
      );

      chunk.forEach((date, idx) => {
        if (results[idx]) rawPrices.set(date, results[idx]!);
      });
    }

    if (rawPrices.size === 0) {
      console.warn('[price] Metals-API returned no usable data — falling back to seed');
      return this.loadSeedData();
    }

    console.log(`[price] Received data for ${rawPrices.size}/${dates.length} trading days`);
    return this.buildSummary(rawPrices, 'metals-api');
  }

  /** Load the bundled offline seed data. Always succeeds. */
  public loadSeedData(): PriceDataSummary {
    const seedPath = path.resolve(__dirname, '../data/seed-prices.json');
    const seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as SeedFile;

    // Pivot seed into date → {ND, PR, LI, CO} map
    const rawPrices = new Map<string, Record<MetalSymbol, number>>();
    for (const symbol of SYMBOLS) {
      for (const { date, priceUsd } of seed.prices[symbol] ?? []) {
        if (!rawPrices.has(date)) rawPrices.set(date, {} as Record<MetalSymbol, number>);
        rawPrices.get(date)![symbol] = priceUsd;
      }
    }

    return this.buildSummary(rawPrices, 'seed');
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Call Metals-API for one historical date.
   * Rates from the API represent "units of metal per 1 USD", so we invert them.
   * Returns null on any network/parse error — the date is then skipped.
   */
  private async fetchDateFromApi(
    date: string,
  ): Promise<Record<MetalSymbol, number> | null> {
    const symbolList = SYMBOLS.join(',');
    const url =
      `https://metals-api.com/api/${date}` +
      `?access_key=${this.apiKey}&base=USD&symbols=${symbolList}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;

      const json = (await res.json()) as { success: boolean; rates?: Record<string, number> };
      if (!json.success || !json.rates) return null;

      const result: Partial<Record<MetalSymbol, number>> = {};
      for (const s of SYMBOLS) {
        const rate = json.rates[s];
        if (rate && rate > 0) result[s] = RATE_TO_USD_PER_KG(rate);
      }

      // Only accept days where all four metals have valid prices
      if (SYMBOLS.every(s => result[s] != null)) {
        return result as Record<MetalSymbol, number>;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Build a list of ISO date strings for Monday–Friday trading days,
   * ending on "today" and going back `daysBack` calendar days.
   */
  private buildTradingDays(daysBack: number): string[] {
    const days: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = daysBack; offset >= 0; offset--) {
      const d = new Date(today);
      d.setDate(d.getDate() - offset);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // skip Saturday/Sunday
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }

  /** Convert a raw date→prices map into a fully computed PriceDataSummary. */
  private buildSummary(
    rawPrices: Map<string, Record<MetalSymbol, number>>,
    source: 'metals-api' | 'seed',
  ): PriceDataSummary {
    const sortedDates = [...rawPrices.keys()].sort();

    // Build per-metal history
    const metals: Partial<Record<MetalSymbol, MetalPriceHistory>> = {};
    for (const symbol of SYMBOLS) {
      const series = sortedDates
        .filter(d => rawPrices.get(d)?.[symbol] != null)
        .map(d => ({ date: d, priceUsd: rawPrices.get(d)![symbol] }));

      const pxValues = series.map(s => s.priceUsd);
      const avgPrice =
        pxValues.length > 0
          ? Math.round((pxValues.reduce((a, b) => a + b, 0) / pxValues.length) * 100) / 100
          : 0;

      metals[symbol] = {
        symbol,
        name: METAL_INFO[symbol].name,
        weightInBasket: METAL_INFO[symbol].weightInBasket,
        prices: series,
        latestPrice: pxValues[pxValues.length - 1] ?? 0,
        avgPrice,
      };
    }

    // Current basket price (last available date with complete data)
    const lastDate = sortedDates[sortedDates.length - 1];
    const lastPrices = rawPrices.get(lastDate) ?? ({} as Record<MetalSymbol, number>);
    const basketPrice = Math.round(computeBasketPrice(lastPrices) * 100) / 100;

    // Statistics from the basket series
    const metalSeriesMap = {
      ND: metals.ND!.prices,
      PR: metals.PR!.prices,
      LI: metals.LI!.prices,
      CO: metals.CO!.prices,
    } as Record<MetalSymbol, Array<{ date: string; priceUsd: number }>>;

    const statistics = computePriceStatistics(metalSeriesMap);

    return {
      fetchedAt: new Date().toISOString(),
      periodStart: sortedDates[0] ?? '',
      periodEnd: sortedDates[sortedDates.length - 1] ?? '',
      source,
      metals: metals as Record<MetalSymbol, MetalPriceHistory>,
      basketPrice,
      statistics,
    };
  }
}
