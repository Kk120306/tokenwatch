import { estimateCacheSavingsUsd } from "../pricing.js";
import type { ParsedTurn, PricingTable, SessionSource, SessionTotal, TurnSourceFormat } from "../types.js";

export type CostLabel = "trivial" | "cheap" | "moderate" | "expensive" | "very expensive";

export interface ExportGroupSummary {
  name: string;
  prompts: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  averageCostUsd: number;
  costSharePct: number;
}

export interface ExportPromptHighlight {
  index: number;
  timestamp: string;
  model: string;
  source: SessionSource;
  sourceFormat: TurnSourceFormat;
  promptVisibility: ParsedTurn["promptVisibility"];
  topic: string | null;
  promptText: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costSharePct: number;
  cacheHitRate: number;
}

export interface ExportSummary {
  turns: ParsedTurn[];
  total: SessionTotal;
  cacheSavingsUsd: number;
  cacheSavingsRate: number;
  cacheHitRate: number;
  byModel: ExportGroupSummary[];
  byTopic: ExportGroupSummary[];
  bySource: ExportGroupSummary[];
  topPrompts: ExportPromptHighlight[];
  mostExpensivePrompt: ExportPromptHighlight | null;
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
  const topPrompts = createPromptHighlights(sortedTurns, total.costUsd, 5);
  return {
    turns: sortedTurns,
    total,
    cacheSavingsUsd,
    cacheSavingsRate: percentage(cacheSavingsUsd, total.costUsd + cacheSavingsUsd),
    cacheHitRate: percentage(total.cachedInputTokens, total.inputTokens),
    byModel: groupBy(sortedTurns, total.costUsd, (turn) => turn.model),
    byTopic: groupBy(sortedTurns, total.costUsd, (turn) => turn.topic ?? "uncategorized"),
    bySource: groupBy(sortedTurns, total.costUsd, (turn) => turn.source),
    topPrompts,
    mostExpensivePrompt: topPrompts[0] ?? null
  };
}

export function createPromptHighlights(
  turns: readonly ParsedTurn[],
  totalCostUsd: number,
  limit: number
): ExportPromptHighlight[] {
  const indexes = new Map<ParsedTurn, number>();
  for (const [index, turn] of turns.entries()) {
    indexes.set(turn, index + 1);
  }

  return [...turns]
    .sort((a, b) => b.costUsd - a.costUsd || a.timestamp.getTime() - b.timestamp.getTime())
    .slice(0, Math.max(0, limit))
    .map((turn) => ({
      index: indexes.get(turn) ?? 0,
      timestamp: turn.timestampIso ?? turn.timestamp.toISOString(),
      model: turn.model,
      source: turn.source,
      sourceFormat: turn.sourceFormat,
      promptVisibility: turn.promptVisibility,
      topic: turn.topic,
      promptText: turn.promptText,
      inputTokens: turn.inputTokens,
      cachedTokens: turn.cachedTokens,
      outputTokens: turn.outputTokens,
      reasoningTokens: turn.reasoningTokens,
      costUsd: turn.costUsd,
      costSharePct: percentage(turn.costUsd, totalCostUsd),
      cacheHitRate: percentage(turn.cachedTokens, turn.inputTokens)
    }));
}

function groupBy(
  turns: readonly ParsedTurn[],
  totalCostUsd: number,
  getName: (turn: ParsedTurn) => string
): ExportGroupSummary[] {
  const groups = new Map<string, ExportGroupSummary>();
  for (const turn of turns) {
    const name = getName(turn);
    const existing = groups.get(name) ?? {
      name,
      prompts: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      averageCostUsd: 0,
      costSharePct: 0
    };
    existing.prompts += 1;
    existing.inputTokens += turn.inputTokens;
    existing.cachedTokens += turn.cachedTokens;
    existing.outputTokens += turn.outputTokens;
    existing.reasoningTokens += turn.reasoningTokens;
    existing.costUsd += turn.costUsd;
    existing.averageCostUsd = existing.prompts > 0 ? existing.costUsd / existing.prompts : 0;
    existing.costSharePct = percentage(existing.costUsd, totalCostUsd);
    groups.set(name, existing);
  }

  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd || b.prompts - a.prompts || a.name.localeCompare(b.name));
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
