import type { ParsedTurn } from "./types.js";

export const MIN_RECOMMENDATION_TURNS = 5;

export interface Recommendation {
  topic: string;
  currentModel: string;
  currentAvgCost: number;
  cheaperModel: string | null;
  cheaperAvgCost: number | null;
  potentialSavingUsd: number;
  potentialSavingPct: number;
  alreadyOptimal: boolean;
  promptCount: number;
}

const MODEL_NICKNAMES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku (fast, cheap)",
  "claude-haiku-4-5": "claude-haiku (fast, cheap)",
  "claude-sonnet-4-6": "claude-sonnet (balanced)",
  "claude-opus-4-6": "claude-opus (most capable)",
  "gpt-5.5": "gpt-5.5",
  "gpt-5": "gpt-5"
};

interface TopicModelStats {
  model: string;
  promptCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

export function recommendModels(turns: readonly ParsedTurn[]): Recommendation[] {
  const byTopic = new Map<string, ParsedTurn[]>();
  for (const turn of turns) {
    const topic = turn.topic ?? "untagged";
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), turn]);
  }

  return [...byTopic.entries()]
    .map(([topic, topicTurns]) => createRecommendation(topic, topicTurns))
    .sort((a, b) => (
      b.potentialSavingUsd - a.potentialSavingUsd ||
      Number(a.alreadyOptimal) - Number(b.alreadyOptimal) ||
      a.topic.localeCompare(b.topic)
    ));
}

export function modelNickname(model: string): string {
  return MODEL_NICKNAMES[model] ?? model;
}

function createRecommendation(topic: string, turns: readonly ParsedTurn[]): Recommendation {
  const models = summarizeTopicModels(turns);
  const current = [...models].sort((a, b) => (
    b.promptCount - a.promptCount ||
    b.totalCostUsd - a.totalCostUsd ||
    a.model.localeCompare(b.model)
  ))[0];
  const cheapest = [...models].sort((a, b) => (
    a.avgCostUsd - b.avgCostUsd ||
    b.promptCount - a.promptCount ||
    a.model.localeCompare(b.model)
  ))[0];

  const alreadyOptimal = !current || !cheapest || current.model === cheapest.model;
  const potentialSavingUsd = alreadyOptimal
    ? 0
    : Math.max(0, (current.avgCostUsd - cheapest.avgCostUsd) * turns.length);
  const potentialSavingPct = alreadyOptimal || current.avgCostUsd <= 0
    ? 0
    : Math.max(0, (current.avgCostUsd - cheapest.avgCostUsd) / current.avgCostUsd);

  return {
    topic,
    currentModel: current?.model ?? "unknown",
    currentAvgCost: current?.avgCostUsd ?? 0,
    cheaperModel: alreadyOptimal ? null : cheapest?.model ?? null,
    cheaperAvgCost: alreadyOptimal ? null : cheapest?.avgCostUsd ?? null,
    potentialSavingUsd,
    potentialSavingPct,
    alreadyOptimal,
    promptCount: turns.length
  };
}

function summarizeTopicModels(turns: readonly ParsedTurn[]): TopicModelStats[] {
  const grouped = new Map<string, { promptCount: number; totalCostUsd: number }>();
  for (const turn of turns) {
    const current = grouped.get(turn.model) ?? { promptCount: 0, totalCostUsd: 0 };
    current.promptCount += 1;
    current.totalCostUsd += turn.costUsd;
    grouped.set(turn.model, current);
  }

  return [...grouped.entries()].map(([model, summary]) => ({
    model,
    promptCount: summary.promptCount,
    totalCostUsd: summary.totalCostUsd,
    avgCostUsd: summary.promptCount === 0 ? 0 : summary.totalCostUsd / summary.promptCount
  }));
}
