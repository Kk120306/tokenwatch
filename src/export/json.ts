import { createExportSummary } from "./format.js";
import type { GoalMetadata, ParsedTurn, PricingTable, PromptVisibility, SessionSource, SessionTotal, TurnSourceFormat } from "../types.js";

interface JsonReport {
  schemaVersion: 1;
  summary: {
    prompts: number;
    startedAt: string | null;
    endedAt: string | null;
    totals: SessionTotal;
    cache: {
      savingsUsd: number;
      savingsRate: number;
      hitRate: number;
    };
    goal: GoalMetadata | null;
  };
  byModel: JsonGroup[];
  byTopic: JsonGroup[];
  turns: JsonTurn[];
}

interface JsonGroup {
  name: string;
  prompts: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  averageCostUsd: number;
}

interface JsonTurn {
  index: number;
  timestamp: string;
  model: string;
  source: SessionSource;
  sourceFormat: TurnSourceFormat;
  promptVisibility: PromptVisibility;
  topic: string | null;
  topicConfidence: string | null;
  promptText: string | null;
  tokens: {
    input: number;
    cached: number;
    output: number;
    reasoning: number;
  };
  cache: {
    grade: string;
    hitRate: number;
    savingsUsd: number;
  };
  context: {
    window: number | null;
    usagePct: number | null;
  };
  costUsd: number;
  goal: GoalMetadata | null;
}

export function renderJsonReport(
  turns: readonly ParsedTurn[],
  pricing: PricingTable
): string {
  const summary = createExportSummary(turns, pricing);
  const firstTurn = summary.turns[0] ?? null;
  const lastTurn = summary.turns[summary.turns.length - 1] ?? null;
  const report: JsonReport = {
    schemaVersion: 1,
    summary: {
      prompts: summary.turns.length,
      startedAt: firstTurn?.timestampIso ?? firstTurn?.timestamp.toISOString() ?? null,
      endedAt: lastTurn?.timestampIso ?? lastTurn?.timestamp.toISOString() ?? null,
      totals: summary.total,
      cache: {
        savingsUsd: summary.cacheSavingsUsd,
        savingsRate: summary.cacheSavingsRate,
        hitRate: summary.cacheHitRate
      },
      goal: latestGoal(summary.turns)
    },
    byModel: groupBy(summary.turns, (turn) => turn.model),
    byTopic: groupBy(summary.turns, (turn) => turn.topic ?? "uncategorized"),
    turns: summary.turns.map((turn, index) => ({
      index: index + 1,
      timestamp: turn.timestampIso ?? turn.timestamp.toISOString(),
      model: turn.model,
      source: turn.source,
      sourceFormat: turn.sourceFormat,
      promptVisibility: turn.promptVisibility,
      topic: turn.topic,
      topicConfidence: turn.topicConfidence,
      promptText: turn.promptText,
      tokens: {
        input: turn.inputTokens,
        cached: turn.cachedTokens,
        output: turn.outputTokens,
        reasoning: turn.reasoningTokens
      },
      cache: {
        grade: turn.cacheGrade,
        hitRate: turn.cacheHitRate,
        savingsUsd: turn.cacheSavingsUsd
      },
      context: {
        window: turn.contextWindow,
        usagePct: turn.contextUsagePct
      },
      costUsd: turn.costUsd,
      goal: turn.goal
    }))
  };

  return `${JSON.stringify(report, null, 2)}\n`;
}

function groupBy(
  turns: readonly ParsedTurn[],
  getName: (turn: ParsedTurn) => string
): JsonGroup[] {
  const groups = new Map<string, JsonGroup>();
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
      averageCostUsd: 0
    };
    existing.prompts += 1;
    existing.inputTokens += turn.inputTokens;
    existing.cachedTokens += turn.cachedTokens;
    existing.outputTokens += turn.outputTokens;
    existing.reasoningTokens += turn.reasoningTokens;
    existing.costUsd += turn.costUsd;
    existing.averageCostUsd = existing.prompts > 0 ? existing.costUsd / existing.prompts : 0;
    groups.set(name, existing);
  }

  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd || b.prompts - a.prompts || a.name.localeCompare(b.name));
}

function latestGoal(turns: readonly ParsedTurn[]): GoalMetadata | null {
  return [...turns].reverse().find((turn) => turn.goal)?.goal ?? null;
}
