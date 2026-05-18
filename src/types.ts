export type SessionSource = "claude" | "codex";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface GoalMetadata {
  goalId: string;
  objective: string;
  status: string;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
}

export interface TokenTurn {
  updateKey?: string;
  source: SessionSource;
  model: string;
  timestamp: Date;
  timestampIso: string | null;
  promptText: string | null;
  usage: TokenUsage;
  goal?: GoalMetadata | null;
}

export interface TurnSummary extends TokenTurn {
  index: number;
  costUsd: number;
}

export interface SessionTotal {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export type TopicConfidence = "auto" | "manual";
export type CacheGrade = "A" | "B" | "C" | "D" | "F";

export interface ParsedTurn {
  updateKey?: string;
  id: number;
  timestamp: Date;
  timestampIso: string | null;
  model: string;
  source: "claude" | "codex";
  promptText: string | null;
  inputTokens: number;
  cachedTokens: number;
  cacheGrade: CacheGrade;
  cacheHitRate: number;
  cacheSavingsUsd: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  topic: string | null;
  topicConfidence: TopicConfidence | null;
  goal: GoalMetadata | null;
}

export interface PricingEntry {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export type PricingTable = Record<string, PricingEntry>;

export type StorageFormat = "sqlite" | "jsonl" | "log" | "none";

export interface FoundStorageResult {
  source: SessionSource;
  status: "found";
  format: Exclude<StorageFormat, "none">;
  path: string;
  paths: string[];
  pattern?: string;
  model?: string;
  threadId?: string;
  goal?: GoalMetadata | null;
  detail: string;
  warnings: string[];
}

export interface MissingStorageResult {
  source: SessionSource;
  status: "missing";
  format: "none";
  path: null;
  paths: [];
  detail: string;
  warnings: string[];
}

export type StorageResult = FoundStorageResult | MissingStorageResult;
export type CodexStorageResult = StorageResult & { source: "codex" };
export type ClaudeStorageResult = StorageResult & { source: "claude" };

export interface StorageDetectionSummary {
  claude: ClaudeStorageResult;
  codex: CodexStorageResult;
}

export interface WatcherOptions {
  claudeGlob?: string;
  codexDbPath?: string;
  pollIntervalMs: number;
  detectionIntervalMs: number;
  onDetection?: (summary: StorageDetectionSummary) => void;
  logger?: (message: string) => void;
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
  input_tokens_details?: {
    cached_tokens?: number;
  };
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexResponseCompletedEvent {
  type?: string;
  response?: {
    model?: string;
    usage?: CodexTokenCount;
  };
}

export interface CodexLogRow {
  rowid: number;
  feedback_log_body: string | null;
}
