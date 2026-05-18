import type { ClaudeAssistantEntry, TokenTurn } from "../types.js";

const UNKNOWN_MODEL = "unknown";

interface ClaudeLineParser {
  parseLine(line: string): TokenTurn | null;
}

interface ClaudeUserEntry {
  type?: string;
  timestamp?: string;
  message?: {
    content?: unknown;
  };
}

const defaultParser = createClaudeParser();

export function createClaudeParser(): ClaudeLineParser {
  let pendingPromptText: string | null = null;

  return {
    parseLine(line: string): TokenTurn | null {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return null;
      }

      let entry: ClaudeAssistantEntry & ClaudeUserEntry;
      try {
        entry = JSON.parse(trimmed) as ClaudeAssistantEntry & ClaudeUserEntry;
      } catch {
        return null;
      }

      if (entry.type === "user") {
        pendingPromptText = extractPromptText(entry.message?.content);
        return null;
      }

      if (entry.type !== "assistant" || !entry.message?.usage) {
        return null;
      }

      if (!pendingPromptText) {
        return null;
      }

      const usage = entry.message.usage;
      const timestampIso = typeof entry.timestamp === "string" ? entry.timestamp : null;
      const turn: TokenTurn = {
        source: "claude",
        model: entry.message.model ?? UNKNOWN_MODEL,
        timestamp: parseTimestamp(entry.timestamp),
        timestampIso,
        promptText: pendingPromptText,
        usage: {
          inputTokens: toCount(usage.input_tokens),
          cachedInputTokens:
            toCount(usage.cache_creation_input_tokens) +
            toCount(usage.cache_read_input_tokens),
          outputTokens: toCount(usage.output_tokens),
          reasoningTokens: 0
        }
      };
      pendingPromptText = null;
      return turn;
    }
  };
}

export function parseClaudeLine(line: string): TokenTurn | null {
  return defaultParser.parseLine(line);
}

function extractPromptText(content: unknown): string | null {
  if (typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTimestamp(value: unknown): Date {
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
