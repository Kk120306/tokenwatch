import { estimateCacheSavingsUsd, loadPricing } from "./pricing.js";
import type { CacheGrade, ParsedTurn, PricingTable } from "./types.js";

export interface CacheScore {
  cacheGrade: CacheGrade;
  cacheHitRate: number;
  cacheSavingsUsd: number;
}

type CacheScoreInput = Pick<ParsedTurn, "model" | "inputTokens" | "cachedTokens">;

export function scoreCacheEfficiency(
  turn: CacheScoreInput,
  pricing: PricingTable = loadPricing()
): CacheScore {
  const cacheHitRate = turn.inputTokens <= 0
    ? 0
    : clamp(turn.cachedTokens / turn.inputTokens, 0, 1);

  return {
    cacheGrade: gradeCacheHitRate(cacheHitRate),
    cacheHitRate,
    cacheSavingsUsd: estimateCacheSavingsUsd(turn.model, turn.cachedTokens, pricing)
  };
}

export function gradeCacheHitRate(hitRate: number): CacheGrade {
  if (hitRate >= 0.8) {
    return "A";
  }
  if (hitRate >= 0.6) {
    return "B";
  }
  if (hitRate >= 0.4) {
    return "C";
  }
  if (hitRate >= 0.2) {
    return "D";
  }
  return "F";
}

export function describeCacheGrade(grade: CacheGrade): string {
  switch (grade) {
    case "A":
      return "Excellent — almost all context reused";
    case "B":
      return "Good — most context came from cache";
    case "C":
      return "Fair — about half was reused";
    case "D":
      return "Poor — mostly fresh context each time";
    case "F":
      return "None — no caching benefit";
  }
}

export function cacheGradeSortValue(grade: CacheGrade): number {
  switch (grade) {
    case "F":
      return 0;
    case "D":
      return 1;
    case "C":
      return 2;
    case "B":
      return 3;
    case "A":
      return 4;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
