import { MetalSymbol, PriceStatistics } from '../types';

// Basket composition weights — must sum to 1.0.
// Reflects typical EV drivetrain usage: NdPr for traction motor magnets, Li+Co for batteries.
const BASKET_WEIGHTS: Record<MetalSymbol, number> = {
  ND: 0.40, // Neodymium oxide – dominant magnet metal
  PR: 0.20, // Praseodymium oxide – NdPr alloy partner
  LI: 0.30, // Lithium carbonate – battery cathode
  CO: 0.10, // Cobalt – cobalt-based battery cathode stabilization
};

/**
 * Compute daily percentage returns: [(p[i] - p[i-1]) / p[i-1]] * 100
 * Returns an array of length prices.length - 1.
 */
export function computeDailyReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
  }
  return returns;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator).
 * Returns 0 when fewer than 2 values are provided.
 */
export function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Rolling volatility: mean of the standard deviations of consecutive
 * `windowSize`-day windows of daily returns.
 * Falls back to overall std dev when the series is shorter than one window.
 */
export function computeRollingVolatility(
  prices: number[],
  windowSize = 14,
): number {
  const returns = computeDailyReturns(prices);
  if (returns.length < windowSize) return computeStdDev(returns);

  const windowStdDevs: number[] = [];
  for (let i = 0; i <= returns.length - windowSize; i++) {
    windowStdDevs.push(computeStdDev(returns.slice(i, i + windowSize)));
  }
  return windowStdDevs.reduce((a, b) => a + b, 0) / windowStdDevs.length;
}

/**
 * Compute the weighted basket price (USD/kg) from a snapshot of latest prices.
 */
export function computeBasketPrice(
  latestPrices: Record<MetalSymbol, number>,
): number {
  return (Object.keys(BASKET_WEIGHTS) as MetalSymbol[]).reduce(
    (sum, s) => sum + (latestPrices[s] ?? 0) * BASKET_WEIGHTS[s],
    0,
  );
}

/**
 * Derive all PriceStatistics from the per-metal price series.
 * Only dates where ALL four metals have a price are included in the basket.
 */
export function computePriceStatistics(
  metalPrices: Record<MetalSymbol, Array<{ date: string; priceUsd: number }>>,
): PriceStatistics {
  const symbols: MetalSymbol[] = ['ND', 'PR', 'LI', 'CO'];

  // Build date → { ND, PR, LI, CO } map
  const dateMap = new Map<string, Partial<Record<MetalSymbol, number>>>();
  for (const symbol of symbols) {
    for (const { date, priceUsd } of metalPrices[symbol] ?? []) {
      if (!dateMap.has(date)) dateMap.set(date, {});
      dateMap.get(date)![symbol] = priceUsd;
    }
  }

  // Keep only trading days with complete data for all metals
  const completeDates = [...dateMap.keys()]
    .sort()
    .filter(d => symbols.every(s => dateMap.get(d)![s] != null));

  const basketPrices = completeDates.map(d =>
    computeBasketPrice(dateMap.get(d) as Record<MetalSymbol, number>),
  );

  const returns = computeDailyReturns(basketPrices);
  const round = (v: number) => Math.round(v * 1000) / 1000;

  return {
    rollingVolatility14d: round(computeRollingVolatility(basketPrices)),
    empiricalStdDev:      round(computeStdDev(returns)),
    avgDailyReturn:       round(returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0),
    maxReturn:            round(returns.length ? Math.max(...returns) : 0),
    minReturn:            round(returns.length ? Math.min(...returns) : 0),
    dataPointCount:       basketPrices.length,
  };
}
