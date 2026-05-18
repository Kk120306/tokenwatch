export type SessionSource = "claude" | "codex";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface TokenTurn {
  source: SessionSource;
  model: string;
  usage: TokenUsage;
}

export interface TurnSummary extends TokenTurn {
  index: number;
  costUsd: number;
}

export interface SessionTotal {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PricingEntry {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export type PricingTable = Record<string, PricingEntry>;

export interface WatcherOptions {
  claudeGlob: string;
  codexGlob: string;
  pollIntervalMs: number;
}

export interface ActiveSessionFile {
  source: SessionSource;
  path: string;
  mtimeMs: number;
}

export interface ClaudeUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

export interface ClaudeAssistantEntry {
  type?: string;
  message?: {
    model?: string;
    usage?: ClaudeUsage;
  };
}

export interface CodexTokenCount {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface CodexTokenCountEntry {
  type?: string;
  event?: string;
  name?: string;
  token_count?: CodexTokenCount;
  token_counts?: CodexTokenCount;
  usage?: CodexTokenCount;
  turn_context?: {
    model?: string;
  };
  model?: string;
}
