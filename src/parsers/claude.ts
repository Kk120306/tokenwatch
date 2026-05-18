import type { ClaudeAssistantEntry, TokenTurn } from "../types.js";

const UNKNOWN_MODEL = "unknown";

export function parseClaudeLine(line: string): TokenTurn | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let entry: ClaudeAssistantEntry;
  try {
    entry = JSON.parse(trimmed) as ClaudeAssistantEntry;
  } catch {
    return null;
  }

  if (entry.type !== "assistant" || !entry.message?.usage) {
    return null;
  }

  const usage = entry.message.usage;
  return {
    source: "claude",
    model: entry.message.model ?? UNKNOWN_MODEL,
    usage: {
      inputTokens: toCount(usage.input_tokens),
      cachedInputTokens:
        toCount(usage.cache_creation_input_tokens) +
        toCount(usage.cache_read_input_tokens),
      outputTokens: toCount(usage.output_tokens)
    }
  };
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
