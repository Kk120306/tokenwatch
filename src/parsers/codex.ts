import type { CodexTokenCount, CodexTokenCountEntry, TokenTurn, TokenUsage } from "../types.js";

const UNKNOWN_MODEL = "unknown";
const TOKEN_COUNT_MARKERS = new Set(["token_count", "token_counts"]);

export class CodexDeltaParser {
  private previous: TokenUsage | null = null;

  parseLine(line: string): TokenTurn | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return null;
    }

    let entry: CodexTokenCountEntry;
    try {
      entry = JSON.parse(trimmed) as CodexTokenCountEntry;
    } catch {
      return null;
    }

    const counts = extractCounts(entry);
    if (!counts) {
      return null;
    }

    const current = normalizeCounts(counts);
    const delta = this.previous ? diffCounts(current, this.previous) : current;
    this.previous = current;

    if (
      delta.inputTokens === 0 &&
      delta.cachedInputTokens === 0 &&
      delta.outputTokens === 0
    ) {
      return null;
    }

    return {
      source: "codex",
      model: entry.turn_context?.model ?? entry.model ?? UNKNOWN_MODEL,
      usage: delta
    };
  }
}

export function parseCodexLines(lines: Iterable<string>): TokenTurn[] {
  const parser = new CodexDeltaParser();
  const turns: TokenTurn[] = [];
  for (const line of lines) {
    const turn = parser.parseLine(line);
    if (turn) {
      turns.push(turn);
    }
  }
  return turns;
}

function extractCounts(entry: CodexTokenCountEntry): CodexTokenCount | null {
  if (entry.token_count) {
    return entry.token_count;
  }
  if (entry.token_counts) {
    return entry.token_counts;
  }
  if (entry.usage && isTokenCountEvent(entry)) {
    return entry.usage;
  }
  return null;
}

function isTokenCountEvent(entry: CodexTokenCountEntry): boolean {
  return (
    TOKEN_COUNT_MARKERS.has(entry.type ?? "") ||
    TOKEN_COUNT_MARKERS.has(entry.event ?? "") ||
    TOKEN_COUNT_MARKERS.has(entry.name ?? "")
  );
}

function normalizeCounts(counts: CodexTokenCount): TokenUsage {
  return {
    inputTokens: toCount(counts.input_tokens),
    cachedInputTokens: toCount(counts.cached_input_tokens),
    outputTokens: toCount(counts.output_tokens)
  };
}

function diffCounts(current: TokenUsage, previous: TokenUsage): TokenUsage {
  return {
    inputTokens: nonNegativeDelta(current.inputTokens, previous.inputTokens),
    cachedInputTokens: nonNegativeDelta(
      current.cachedInputTokens,
      previous.cachedInputTokens
    ),
    outputTokens: nonNegativeDelta(current.outputTokens, previous.outputTokens)
  };
}

function nonNegativeDelta(current: number, previous: number): number {
  return Math.max(0, current - previous);
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
