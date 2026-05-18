import { costLabel, createExportSummary, percentage } from "./format.js";
import type { ParsedTurn, PricingTable } from "../types.js";

const HEADERS = [
  "#",
  "timestamp",
  "model",
  "source",
  "topic",
  "prompt_text",
  "input_tokens",
  "cached_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cost_usd",
  "cost_label",
  "cache_hit_rate",
  "goal_id",
  "goal_status",
  "goal_tokens_used",
  "goal_token_budget"
];

export function renderCsvReport(
  turns: readonly ParsedTurn[],
  pricing: PricingTable
): string {
  const summary = createExportSummary(turns, pricing);
  const rows = [
    HEADERS,
    ...summary.turns.map((turn, index) => [
      String(index + 1),
      turn.timestampIso ?? turn.timestamp.toISOString(),
      turn.model,
      turn.source,
      turn.topic ?? "",
      turn.promptText ?? "",
      String(turn.inputTokens),
      String(turn.cachedTokens),
      String(turn.outputTokens),
      String(turn.reasoningTokens),
      turn.costUsd.toFixed(6),
      costLabel(turn.costUsd),
      `${percentage(turn.cachedTokens, turn.inputTokens).toFixed(1)}%`,
      turn.goal?.goalId ?? "",
      turn.goal?.status ?? "",
      turn.goal ? String(turn.goal.tokensUsed) : "",
      turn.goal?.tokenBudget === null || turn.goal?.tokenBudget === undefined ? "" : String(turn.goal.tokenBudget)
    ]),
    [
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      String(summary.total.inputTokens),
      String(summary.total.cachedInputTokens),
      String(summary.total.outputTokens),
      String(summary.total.reasoningTokens),
      summary.total.costUsd.toFixed(6),
      "",
      `${summary.cacheHitRate.toFixed(1)}%`,
      "",
      "",
      "",
      ""
    ]
  ];

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
