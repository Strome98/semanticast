// Centralized configuration & environment variable access.
// Loads .env at startup using dotenv.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load .env if present. Warn if only .env.example exists.
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  const examplePath = path.resolve(process.cwd(), ".env.example");
  if (fs.existsSync(examplePath)) {
    console.warn(
      "[config] .env file not found. You edited .env.example but must copy it to .env for values to load."
    );
  } else {
    console.warn(
      "[config] No .env file present. Environment variables must be set externally."
    );
  }
}

export interface AppConfig {
  openAiKey?: string;
  newsApiKey?: string;
  environment: "development" | "production" | "test";
  skipFetch: boolean; // Skip news fetching and use existing aggregate summary
}

export function getConfig(): AppConfig {
  return {
    openAiKey: process.env.OPENAI_API_KEY,
    newsApiKey: process.env.NEWS_API_KEY,
    environment: (process.env.NODE_ENV as any) || "development",
    skipFetch: process.env.SKIP_FETCH === "true",
  };
}

export function requireConfigKeys(keys: (keyof AppConfig)[]) {
  const cfg = getConfig();
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`Missing required config keys: ${missing.join(", ")}`);
  }
  return cfg;
}
