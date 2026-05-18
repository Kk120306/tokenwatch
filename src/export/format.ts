import { estimateCacheSavingsUsd } from "../pricing.js";
import type { ParsedTurn, PricingTable, SessionTotal } from "../types.js";

export type CostLabel = "trivial" | "cheap" | "moderate" | "expensive" | "very expensive";

export interface ExportSummary {
  turns: ParsedTurn[];
  total: SessionTotal;
  cacheSavingsUsd: number;
  cacheSavingsRate: number;
  cacheHitRate: number;
}

export function createExportSummary(
  turns: readonly ParsedTurn[],
  pricing: PricingTable
): ExportSummary {
  const sortedTurns = [...turns].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const total = sortedTurns.reduce<SessionTotal>((current, turn) => ({
    inputTokens: current.inputTokens + turn.inputTokens,
    cachedInputTokens: current.cachedInputTokens + turn.cachedTokens,
    outputTokens: current.outputTokens + turn.outputTokens,
    reasoningTokens: current.reasoningTokens + turn.reasoningTokens,
    costUsd: current.costUsd + turn.costUsd
  }), {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0
  });
  const cacheSavingsUsd = sortedTurns.reduce(
    (sum, turn) => sum + estimateCacheSavingsUsd(turn.model, turn.cachedTokens, pricing),
    0
  );
  return {
    turns: sortedTurns,
    total,
    cacheSavingsUsd,
    cacheSavingsRate: percentage(cacheSavingsUsd, total.costUsd + cacheSavingsUsd),
    cacheHitRate: percentage(total.cachedInputTokens, total.inputTokens)
  };
}

export function costLabel(costUsd: number): CostLabel {
  if (costUsd < 0.001) {
    return "trivial";
  }
  if (costUsd < 0.01) {
    return "cheap";
  }
  if (costUsd < 0.05) {
    return "moderate";
  }
  if (costUsd < 0.25) {
    return "expensive";
  }
  return "very expensive";
}

export function percentage(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return (part / total) * 100;
}

export function formatUsdApprox(value: number, digits = 2): string {
  return `~$${value.toFixed(digits)}`;
}

export function formatTokenCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2).replace(/\.0+$/, "")}k`;
  }
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDateLong(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date).replace(/,/g, "");
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatDuration(start: Date, end: Date): string {
  const elapsedMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatFilenameDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
