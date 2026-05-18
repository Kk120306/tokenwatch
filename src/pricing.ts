import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PricingTable, TokenUsage } from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultPricingPath = resolve(currentDir, "../pricing.json");

export function loadPricing(path = defaultPricingPath): PricingTable {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PricingTable;
}

export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  pricing: PricingTable
): number {
  const entry = pricing[model];
  if (!entry) {
    return 0;
  }

  return (
    (usage.inputTokens / 1_000_000) * entry.inputPerMillion +
    (usage.cachedInputTokens / 1_000_000) * entry.cachedInputPerMillion +
    (usage.outputTokens / 1_000_000) * entry.outputPerMillion
  );
}

export function estimateCacheSavingsUsd(
  model: string,
  cachedTokens: number,
  pricing: PricingTable
): number {
  const entry = pricing[model];
  if (!entry) {
    return 0;
  }

  return (
    (cachedTokens / 1_000_000) *
    Math.max(0, entry.inputPerMillion - entry.cachedInputPerMillion)
  );
}
