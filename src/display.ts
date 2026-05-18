import chalk from "chalk";
import type { SessionTotal, TurnSummary } from "./types.js";

const HIGH_COST_THRESHOLD_USD = 0.01;
const RULE_WIDTH = 69;

export function createEmptyTotal(): SessionTotal {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0
  };
}

export function addToTotal(total: SessionTotal, turn: TurnSummary): SessionTotal {
  return {
    inputTokens: total.inputTokens + turn.usage.inputTokens,
    cachedInputTokens: total.cachedInputTokens + turn.usage.cachedInputTokens,
    outputTokens: total.outputTokens + turn.usage.outputTokens,
    reasoningTokens: total.reasoningTokens + (turn.usage.reasoningTokens ?? 0),
    costUsd: total.costUsd + turn.costUsd
  };
}

export function formatTurn(turn: TurnSummary): string {
  const line = `[#${turn.index}] in: ${formatCount(turn.usage.inputTokens)}  cached: ${formatCount(turn.usage.cachedInputTokens)}  out: ${formatCount(turn.usage.outputTokens)}  ~${formatUsd(turn.costUsd)}  ${turn.model}`;
  return turn.costUsd > HIGH_COST_THRESHOLD_USD ? chalk.yellow(line) : line;
}

export function formatSessionTotal(total: SessionTotal): string {
  return chalk.dim(
    `session  in: ${formatCount(total.inputTokens)}  cached: ${formatCount(total.cachedInputTokens)}  out: ${formatCount(total.outputTokens)}  ~${formatUsd(total.costUsd)}`
  );
}

export function renderSummary(turns: readonly TurnSummary[], total: SessionTotal): string {
  const lines = turns.map(formatTurn);
  lines.push(formatSeparator());
  lines.push(formatSessionTotal(total));
  return lines.join("\n");
}

export function formatSeparator(): string {
  return chalk.dim("─".repeat(RULE_WIDTH));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}
