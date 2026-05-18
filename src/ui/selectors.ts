import { estimateCacheSavingsUsd } from "../pricing.js";
import type { GoalMetadata, ParsedTurn, PricingTable } from "../types.js";

export interface ModelSummary {
  model: string;
  promptCount: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

export interface TopicSummary {
  topic: string;
  promptCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

export interface Recommendation {
  text: string;
}

export interface StatsSummary {
  totalCostUsd: number;
  totalPrompts: number;
  durationMs: number;
  avgCostUsd: number;
  mostExpensiveTurn: ParsedTurn | null;
  cacheHitRate: number;
  cacheSavingsUsd: number;
  mostExpensiveTopic: TopicSummary | null;
  cheapestTopic: TopicSummary | null;
  topTopics: TopicSummary[];
  goal: (GoalMetadata & { promptCount: number }) | null;
}

export function uniqueModels(turns: readonly ParsedTurn[]): string[] {
  return uniqueSorted(turns.map((turn) => normalizeModel(turn.model)));
}

export function uniqueTopics(turns: readonly ParsedTurn[]): string[] {
  return uniqueSorted(turns.map((turn) => turn.topic ?? "untagged"));
}

export function filterTurns(
  turns: readonly ParsedTurn[],
  filterModels: readonly string[],
  filterTopics: readonly string[]
): ParsedTurn[] {
  const modelSet = new Set(filterModels);
  const topicSet = new Set(filterTopics);
  return [...turns]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || sourceSortKey(a.source) - sourceSortKey(b.source))
    .filter((turn) => {
      const modelMatches = modelSet.has(normalizeModel(turn.model));
      const topicMatches = topicSet.has(turn.topic ?? "untagged");
      return modelMatches && topicMatches;
    });
}

export function summarizeModels(turns: readonly ParsedTurn[]): ModelSummary[] {
  const grouped = new Map<string, {
    promptCount: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalCostUsd: number;
  }>();
  for (const turn of turns) {
    const model = normalizeModel(turn.model);
    const current = grouped.get(model) ?? {
      promptCount: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalCostUsd: 0
    };
    current.promptCount += 1;
    current.inputTokens += turn.inputTokens;
    current.cachedTokens += turn.cachedTokens;
    current.outputTokens += turn.outputTokens;
    current.reasoningTokens += turn.reasoningTokens;
    current.totalCostUsd += turn.costUsd;
    grouped.set(model, current);
  }

  return [...grouped.entries()]
    .map(([model, summary]) => ({
      model,
      promptCount: summary.promptCount,
      inputTokens: summary.inputTokens,
      cachedTokens: summary.cachedTokens,
      outputTokens: summary.outputTokens,
      reasoningTokens: summary.reasoningTokens,
      totalCostUsd: summary.totalCostUsd,
      avgCostUsd: summary.promptCount === 0 ? 0 : summary.totalCostUsd / summary.promptCount
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.model.localeCompare(b.model));
}

export function summarizeTopics(turns: readonly ParsedTurn[]): TopicSummary[] {
  const grouped = new Map<string, { promptCount: number; totalCostUsd: number }>();
  for (const turn of turns) {
    const topic = turn.topic ?? "untagged";
    const current = grouped.get(topic) ?? { promptCount: 0, totalCostUsd: 0 };
    current.promptCount += 1;
    current.totalCostUsd += turn.costUsd;
    grouped.set(topic, current);
  }

  return [...grouped.entries()]
    .map(([topic, summary]) => ({
      topic,
      promptCount: summary.promptCount,
      totalCostUsd: summary.totalCostUsd,
      avgCostUsd: summary.promptCount === 0 ? 0 : summary.totalCostUsd / summary.promptCount
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.topic.localeCompare(b.topic));
}

export function summarizeStats(
  turns: readonly ParsedTurn[],
  pricing: PricingTable
): StatsSummary {
  const totalCostUsd = turns.reduce((total, turn) => total + turn.costUsd, 0);
  const totalPrompts = turns.length;
  const inputTokens = turns.reduce((total, turn) => total + turn.inputTokens, 0);
  const cachedTokens = turns.reduce((total, turn) => total + turn.cachedTokens, 0);
  const cacheSavingsUsd = turns.reduce(
    (total, turn) => total + estimateCacheSavingsUsd(normalizeModel(turn.model), turn.cachedTokens, pricing),
    0
  );
  const sortedByTime = [...turns].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || sourceSortKey(a.source) - sourceSortKey(b.source));
  const firstTurn = sortedByTime[0] ?? null;
  const lastTurn = sortedByTime.at(-1) ?? null;
  const topics = summarizeTopics(turns);
  const mostExpensiveTurn = [...turns].sort((a, b) => b.costUsd - a.costUsd)[0] ?? null;
  const topicsByAverage = [...topics].sort((a, b) => b.avgCostUsd - a.avgCostUsd);
  const goal = summarizeGoal(turns);

  return {
    totalCostUsd,
    totalPrompts,
    durationMs: firstTurn && lastTurn
      ? Math.max(0, lastTurn.timestamp.getTime() - firstTurn.timestamp.getTime())
      : 0,
    avgCostUsd: totalPrompts === 0 ? 0 : totalCostUsd / totalPrompts,
    mostExpensiveTurn,
    cacheHitRate: inputTokens === 0 ? 0 : cachedTokens / inputTokens,
    cacheSavingsUsd,
    mostExpensiveTopic: topicsByAverage[0] ?? null,
    cheapestTopic: topicsByAverage.at(-1) ?? null,
    topTopics: topics.slice(0, 5),
    goal
  };
}

export function recommendModel(models: readonly ModelSummary[]): Recommendation | null {
  if (models.length < 2) {
    return null;
  }

  const byAverage = [...models]
    .filter((model) => model.promptCount > 0)
    .sort((a, b) => a.avgCostUsd - b.avgCostUsd);
  const cheapest = byAverage[0];
  const mostExpensive = byAverage.at(-1);
  if (!cheapest || !mostExpensive || cheapest.model === mostExpensive.model || cheapest.avgCostUsd <= 0) {
    return null;
  }

  const multiplier = Math.max(1, Math.round(mostExpensive.avgCostUsd / cheapest.avgCostUsd));
  return {
    text: `Recommendation: use ${cheapest.model} for routine prompts (${multiplier}x cheaper/prompt than ${mostExpensive.model})`
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function normalizeModel(model: unknown): string {
  return typeof model === "string" && model.trim().length > 0
    ? model
    : "unknown";
}

function sourceSortKey(source: ParsedTurn["source"]): number {
  return source === "claude" ? 0 : 1;
}

function summarizeGoal(turns: readonly ParsedTurn[]): (GoalMetadata & { promptCount: number }) | null {
  const goalTurns = turns.filter((turn) => turn.goal);
  const latestGoal = goalTurns.at(-1)?.goal;
  if (!latestGoal) {
    return null;
  }
  return {
    ...latestGoal,
    promptCount: goalTurns.filter((turn) => turn.goal?.goalId === latestGoal.goalId).length
  };
}
