import {
  costLabel,
  createExportSummary,
  formatDateLong,
  formatDuration,
  formatTime,
  formatTokenCount,
  formatUsdApprox
} from "./format.js";
import type { GoalMetadata, ParsedTurn, PricingTable } from "../types.js";

interface GroupRow {
  name: string;
  prompts: number;
  total: number;
}

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
    "| Model | Prompts | Total | Avg/prompt |",
    "|---|---|---|---|",
    ...renderGroupRows(groupBy(summary.turns, (turn) => turn.model)),
    "",
    renderRecommendation(groupBy(summary.turns, (turn) => turn.model)),
    "",
    "## By topic",
    "| Topic | Prompts | Total | Avg/prompt |",
    "|---|---|---|---|",
    ...renderGroupRows(groupBy(summary.turns, (turn) => turn.topic ?? "uncategorized")),
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

function groupBy(
  turns: readonly ParsedTurn[],
  getName: (turn: ParsedTurn) => string
): GroupRow[] {
  const groups = new Map<string, GroupRow>();
  for (const turn of turns) {
    const name = getName(turn);
    const existing = groups.get(name) ?? { name, prompts: 0, total: 0 };
    existing.prompts += 1;
    existing.total += turn.costUsd;
    groups.set(name, existing);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || b.prompts - a.prompts || a.name.localeCompare(b.name));
}

function renderGroupRows(rows: readonly GroupRow[]): string[] {
  if (rows.length === 0) {
    return ["| none | 0 | ~$0.00 | ~$0.000 |"];
  }
  return rows.map((row) => {
    const average = row.prompts > 0 ? row.total / row.prompts : 0;
    return `| ${escapeTableCell(row.name)} | ${row.prompts} | ${formatUsdApprox(row.total)} | ${formatUsdApprox(average, 3)} |`;
  });
}

function renderRecommendation(rows: readonly GroupRow[]): string {
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

function averageCost(row: GroupRow): number {
  return row.prompts > 0 ? row.total / row.prompts : 0;
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
