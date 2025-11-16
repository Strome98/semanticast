# SemantiCast

**Predicting rare earth metal prices from semantic analysis of automotive industry news**

## Overview

SemantiCast is an AI-powered microservice that analyzes news articles about rare earth metals in the automotive/EV sector to predict price movements over the next 14 days. It combines:

- Multi-source news fetching and filtering
- AI-powered relevance and sentiment analysis
- Price impact assessment
- Historical volatility modeling
- 14-day price prediction with confidence scoring

## Features

- **Multi-query news fetching** - Maximizes NewsAPI free tier by fetching from 4 targeted queries
- **Parallel processing** - Processes articles in batches for faster analysis
- **Automotive focus** - Filters for EV/automotive-relevant rare earth content (batteries, magnets, motors)
- **Comprehensive analysis** - Sentiment, price impact, and category classification
- **Price prediction** - 14-day forecast combining news sentiment with baseline volatility
- **Prediction-only mode** - Skip fetching and reanalyze existing data instantly

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and add your API keys:
```bash
OPENAI_API_KEY=your_openai_key
NEWS_API_KEY=your_newsapi_key
SKIP_FETCH=false
```

### 3. Run analysis
```bash
# Full mode: Fetch news and analyze
npm run dev

# Prediction-only mode: Use latest aggregate summary
# Set SKIP_FETCH=true in .env, then:
npm run dev
```

### 4. View the Dashboard
```bash
# Start the web server
npm run server

# Open browser to http://localhost:3000
```

The dashboard displays:
- 28-day price chart (14 days historical + 14 days predicted)
- Price prediction statistics with confidence
- Article analysis breakdown
- Market signals and sentiment distributions
- Dominant drivers and narrative

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for semantic analysis | Required |
| `NEWS_API_KEY` | NewsAPI key for fetching articles | Required |
| `SKIP_FETCH` | Skip fetching, use latest aggregate summary | `false` |
| `NODE_ENV` | Environment (development/production) | `development` |

## Output

Results are saved to `output/aggregate-summary-YYYY-MM-DD.json` containing:

- Article statistics and distributions
- Sentiment and price impact analysis
- Dominant market drivers
- AI-generated narrative
- **14-day price prediction** with:
  - Predicted percentage change
  - Predicted USD change
  - Price target
  - Confidence score
  - Reasoning

## Usage Modes

### Full Analysis Mode (SKIP_FETCH=false)
- Fetches up to ~400 articles from NewsAPI (4 queries × 100 articles)
- Processes articles in parallel batches
- Generates aggregate summary and prediction
- Saves to JSON file
- **Time**: ~2-5 minutes depending on article count

### Prediction-Only Mode (SKIP_FETCH=true)
- Loads latest `aggregate-summary-*.json` from output/
- Regenerates 14-day price prediction instantly
- Useful for testing different prediction models
- **Time**: <1 second

## Architecture

```
src/
├── classifiers/        # Sentiment and price impact analyzers
├── fetchers/          # NewsAPI integration
├── predictors/        # 14-day price prediction engine
├── services/          # OpenAI service wrapper
└── types.ts           # TypeScript interfaces
```

