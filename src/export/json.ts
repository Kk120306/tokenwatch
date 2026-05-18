import { createExportSummary, type ExportGroupSummary, type ExportPromptHighlight } from "./format.js";
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
    mostExpensivePrompt: ExportPromptHighlight | null;
  };
  byModel: ExportGroupSummary[];
  byTopic: ExportGroupSummary[];
  bySource: ExportGroupSummary[];
  topPrompts: ExportPromptHighlight[];
  turns: JsonTurn[];
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
      goal: latestGoal(summary.turns),
      mostExpensivePrompt: summary.mostExpensivePrompt
    },
    byModel: summary.byModel,
    byTopic: summary.byTopic,
    bySource: summary.bySource,
    topPrompts: summary.topPrompts,
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

function latestGoal(turns: readonly ParsedTurn[]): GoalMetadata | null {
  return [...turns].reverse().find((turn) => turn.goal)?.goal ?? null;
}
