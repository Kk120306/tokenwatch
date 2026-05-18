import {
  costLabel,
  createExportSummary,
  formatDateLong,
  formatDuration,
  formatTime,
  formatTokenCount,
  formatUsdApprox
} from "./format.js";
import type { ExportGroupSummary, ExportPromptHighlight } from "./format.js";
import type { GoalMetadata, ParsedTurn, PricingTable } from "../types.js";

export function renderMarkdownReport(
  turns: readonly ParsedTurn[],
  pricing: PricingTable
): string {
  const summary = createExportSummary(turns, pricing);
  const firstTurn = summary.turns[0];
  const lastTurn = summary.turns[summary.turns.length - 1] ?? firstTurn;
  const reportDate = firstTurn?.timestamp ?? new Date();
  const duration = firstTurn && lastTurn
    ? formatDuration(firstTurn.timestamp, lastTurn.timestamp)
    : "0m";
  const goal = latestGoal(summary.turns);

  const lines: string[] = [
    "# tokenwatch session report",
    "",
    `**Date:** ${formatDateLong(reportDate)} | **Duration:** ${duration}`,
    `**Total cost:** ${formatUsdApprox(summary.total.costUsd)} | **Prompts:** ${summary.turns.length} | **Cache savings:** ${formatUsdApprox(summary.cacheSavingsUsd)} (${Math.round(summary.cacheSavingsRate)}%)`,
    ...(goal ? [
      `**Goal mode:** ${goal.status} | **Goal tokens:** ${formatTokenCount(goal.tokensUsed)}${goal.tokenBudget === null ? "" : ` / ${formatTokenCount(goal.tokenBudget)}`} | **Goal time:** ${formatDuration(new Date(0), new Date(goal.timeUsedSeconds * 1000))}`,
      `**Goal objective:** ${goal.objective || goal.goalId}`
    ] : []),
    "",
    "## By model",
    "| Model | Prompts | Total | Avg/prompt | Share |",
    "|---|---|---|---|---|",
    ...renderGroupRows(summary.byModel),
    "",
    renderRecommendation(summary.byModel),
    "",
    "## By source",
    "| Source | Prompts | Total | Avg/prompt | Share |",
    "|---|---|---|---|---|",
    ...renderGroupRows(summary.bySource),
    "",
    "## By topic",
    "| Topic | Prompts | Total | Avg/prompt | Share |",
    "|---|---|---|---|---|",
    ...renderGroupRows(summary.byTopic),
    "",
    "## Costliest prompts",
    "| # | Source | Topic | Model | Total | Share | Prompt |",
    "|---|---|---|---|---|---|---|",
    ...renderTopPromptRows(summary.topPrompts),
    "",
    "## Prompt log"
  ];

  for (const [index, turn] of summary.turns.entries()) {
    lines.push(
      `### #${index + 1} — ${turn.topic ?? "uncategorized"} — ${turn.model} — ${formatUsdApprox(turn.costUsd)} — ${costLabel(turn.costUsd)}`,
      `**Time:** ${formatTime(turn.timestamp)} | ${formatTokenCount(turn.inputTokens)} in · ${formatTokenCount(turn.cachedTokens)} cached · ${formatTokenCount(turn.outputTokens)} out`,
      `**Source:** ${turn.source} ${turn.sourceFormat} | **Prompt visibility:** ${formatPromptVisibility(turn.promptVisibility)}`,
      `> ${formatPromptText(turn.promptText)}`,
      "---",
      ""
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderGroupRows(rows: readonly ExportGroupSummary[]): string[] {
  if (rows.length === 0) {
    return ["| none | 0 | ~$0.00 | ~$0.000 | 0% |"];
  }
  return rows.map((row) => {
    return `| ${escapeTableCell(row.name)} | ${row.prompts} | ${formatUsdApprox(row.costUsd)} | ${formatUsdApprox(row.averageCostUsd, 3)} | ${Math.round(row.costSharePct)}% |`;
  });
}

function renderTopPromptRows(prompts: readonly ExportPromptHighlight[]): string[] {
  if (prompts.length === 0) {
    return ["| none | none | none | none | ~$0.00 | 0% | *prompt text unavailable* |"];
  }
  return prompts.map((prompt) => (
    `| ${prompt.index} | ${prompt.source} ${prompt.sourceFormat} | ${escapeTableCell(prompt.topic ?? "uncategorized")} | ${escapeTableCell(prompt.model)} | ${formatUsdApprox(prompt.costUsd)} | ${Math.round(prompt.costSharePct)}% | ${escapeTableCell(formatPromptText(prompt.promptText))} |`
  ));
}

function renderRecommendation(rows: readonly ExportGroupSummary[]): string {
  if (rows.length < 2) {
    return "**Recommendation:** single-model session; no cheaper model comparison available";
  }
  const byAverage = [...rows].sort((a, b) => averageCost(a) - averageCost(b));
  const cheapest = byAverage[0];
  const costliest = byAverage[byAverage.length - 1];
  const ratio = averageCost(cheapest) > 0
    ? Math.max(1, Math.round(averageCost(costliest) / averageCost(cheapest)))
    : 1;
  return `**Recommendation:** ${cheapest.name} is ${ratio}x cheaper on average than ${costliest.name}`;
}

function averageCost(row: ExportGroupSummary): number {
  return row.averageCostUsd;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function formatPromptText(promptText: string | null): string {
  if (!promptText) {
    return "*prompt text unavailable*";
  }
  const normalized = promptText.replace(/\s+/g, " ").trim();
  if (normalized.length <= 200) {
    return normalized;
  }
  return `${normalized.slice(0, 197)}...`;
}

function formatPromptVisibility(visibility: ParsedTurn["promptVisibility"]): string {
  if (visibility === "prompt-and-usage") {
    return "prompt text paired with usage";
  }
  if (visibility === "best-effort-prompt") {
    return "prompt text attached best-effort";
  }
  return "usage counted; prompt text unavailable";
}

function latestGoal(turns: readonly ParsedTurn[]): GoalMetadata | null {
  return [...turns].reverse().find((turn) => turn.goal)?.goal ?? null;
}
