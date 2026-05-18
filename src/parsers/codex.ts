import type { CodexLogRow, CodexResponseCompletedEvent, TokenTurn, TokenUsage } from "../types.js";

const UNKNOWN_MODEL = "unknown";
const CODEX_MESSAGE_PREFIX = "Received message ";
const RESPONSE_COMPLETED_TYPE = "response.completed";
const EVENT_MSG_TYPE = "event_msg";
const USER_MESSAGE_TYPE = "user_message";
const TOKEN_COUNT_TYPE = "token_count";
const MIN_USER_PROMPT_LENGTH = 10;
const BLOCKED_PROMPT_ROLES = new Set(["assistant", "developer", "system", "tool"]);
const BLOCKED_PROMPT_SOURCES = new Set(["agent", "internal", "system", "tool"]);
const INTERNAL_PROMPT_PATTERNS = [
  /^<\|/,
  /^<tool(?:_call|_result)?\b/i,
  /^(?:function|tool)_call\b/i,
  /^\{\s*"(?:cmd|function_call|tool_call|arguments)"\s*:/i,
  /^You are OMX (?:Explore|Sparkshell)\b/i,
  /^You are executing the `omx /i,
  /Shell-only repository exploration contract/i,
  /^# AGENTS\.md instructions for /
];

interface CodexJsonlParserOptions {
  model?: string;
  getModel?: () => string | undefined;
}

interface CodexJsonlParser {
  parseLine(line: string): TokenTurn | null;
}

interface CodexSqliteParser {
  parseRow(row: CodexLogRow): TokenTurn | null;
}

interface ActiveCodexPrompt {
  updateKey: string;
  promptText: string;
  timestamp: Date;
  timestampIso: string | null;
  usage: TokenUsage;
  contextInputTokens: number | null;
  contextWindow: number | null;
}

interface CodexRolloutEntry {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    message?: unknown;
    role?: unknown;
    source?: unknown;
    info?: {
      model_context_window?: number;
      last_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
  };
}

let nextParserId = 0;
const defaultJsonlParser = createCodexJsonlParser();

export function parseCodexLogRow(row: CodexLogRow): TokenTurn | null {
  return parseCodexFeedbackLogBody(row.feedback_log_body);
}

export function createCodexSqliteParser(): CodexSqliteParser {
  let pendingPromptText: string | null = null;

  return {
    parseRow(row: CodexLogRow): TokenTurn | null {
      const event = parseCodexFeedbackEvent(row.feedback_log_body);
      if (!event) {
        return null;
      }

      const promptText = findUserPromptText(event);
      if (promptText) {
        pendingPromptText = promptText;
        return null;
      }

      const responseCompleted = findResponseCompletedEvent(event);
      const turn = responseCompleted
        ? turnFromResponseCompletedEvent(responseCompleted, pendingPromptText)
        : null;
      if (turn) {
        pendingPromptText = null;
      }
      return turn;
    }
  };
}

export function createCodexJsonlParser(options: CodexJsonlParserOptions = {}): CodexJsonlParser {
  const parserId = ++nextParserId;
  let nextPromptId = 0;
  let activePrompt: ActiveCodexPrompt | null = null;

  return {
    parseLine(line: string): TokenTurn | null {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return null;
      }

      const direct = trimmed.startsWith(CODEX_MESSAGE_PREFIX)
        ? parseCodexFeedbackLogBody(trimmed)
        : null;
      if (direct) {
        return direct;
      }

      let entry: unknown;
      try {
        entry = JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }

      const rolloutTurn = parseRolloutEntry(entry);
      if (rolloutTurn.kind === "prompt") {
        if (rolloutTurn.promptText) {
          activePrompt = {
            updateKey: `codex-rollout:${parserId}:${++nextPromptId}`,
            promptText: rolloutTurn.promptText,
            timestamp: parseTimestamp(rolloutTurn.timestampIso),
            timestampIso: rolloutTurn.timestampIso,
            usage: createEmptyUsage(),
            contextInputTokens: null,
            contextWindow: null
          };
        }
        return null;
      }
      if (rolloutTurn.kind === "usage") {
        if (!activePrompt) {
          return null;
        }
        activePrompt = {
          ...activePrompt,
          usage: addUsage(activePrompt.usage, rolloutTurn.usage),
          contextInputTokens: rolloutTurn.usage.inputTokens,
          contextWindow: rolloutTurn.contextWindow ?? activePrompt.contextWindow
        };
        return turnFromActivePrompt(activePrompt, options);
      }

      if (activePrompt) {
        return null;
      }

      const event = findResponseCompletedEvent(entry);
      return event ? turnFromResponseCompletedEvent(event) : null;
    }
  };
}

export function parseCodexJsonlLine(line: string): TokenTurn | null {
  return defaultJsonlParser.parseLine(line);
}

export function parseCodexFeedbackLogBody(body: string | null): TokenTurn | null {
  const event = parseCodexFeedbackEvent(body);
  const responseCompleted = findResponseCompletedEvent(event);
  return responseCompleted ? turnFromResponseCompletedEvent(responseCompleted) : null;
}

function parseCodexFeedbackEvent(body: string | null): unknown | null {
  if (!body) {
    return null;
  }

  const payload = extractJsonPayload(body);
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function turnFromResponseCompletedEvent(
  event: CodexResponseCompletedEvent,
  promptText: string | null = null
): TokenTurn | null {
  if (event.type !== RESPONSE_COMPLETED_TYPE) {
    return null;
  }

  const usage = event.response?.usage;
  if (!usage) {
    return null;
  }

  const normalizedUsage: TokenUsage = {
    inputTokens: toCount(usage.input_tokens),
    cachedInputTokens: toCount(
      usage.input_tokens_details?.cached_tokens ?? usage.cached_input_tokens
    ),
    outputTokens: toCount(usage.output_tokens),
    reasoningTokens: toCount(usage.reasoning_output_tokens)
  };

  if (
    normalizedUsage.inputTokens === 0 &&
    normalizedUsage.cachedInputTokens === 0 &&
    normalizedUsage.outputTokens === 0 &&
    normalizedUsage.reasoningTokens === 0
  ) {
    return null;
  }

  return {
    source: "codex",
    model: event.response?.model ?? UNKNOWN_MODEL,
    timestamp: new Date(),
    timestampIso: null,
    promptText,
    usage: normalizedUsage
  };
}

type RolloutParseResult =
  | { kind: "none" }
  | { kind: "prompt"; promptText: string | null; timestampIso: string | null }
  | { kind: "usage"; usage: TokenUsage; contextWindow: number | null };

function parseRolloutEntry(value: unknown): RolloutParseResult {
  if (!value || typeof value !== "object") {
    return { kind: "none" };
  }

  const entry = value as CodexRolloutEntry;
  if (isRolloutPromptEntry(entry)) {
    const promptText = findUserPromptText(entry);
    return {
      kind: "prompt",
      promptText,
      timestampIso: typeof entry.timestamp === "string" ? entry.timestamp : null
    };
  }

  if (entry.type !== EVENT_MSG_TYPE) {
    return { kind: "none" };
  }

  if (entry.payload?.type !== TOKEN_COUNT_TYPE) {
    return { kind: "none" };
  }

  const usage = entry.payload.info?.last_token_usage;
  if (!usage) {
    return { kind: "none" };
  }

  const normalizedUsage: TokenUsage = {
    inputTokens: toCount(usage.input_tokens),
    cachedInputTokens: toCount(usage.cached_input_tokens),
    outputTokens: toCount(usage.output_tokens),
    reasoningTokens: toCount(usage.reasoning_output_tokens)
  };

  if (
    normalizedUsage.inputTokens === 0 &&
    normalizedUsage.cachedInputTokens === 0 &&
    normalizedUsage.outputTokens === 0 &&
    normalizedUsage.reasoningTokens === 0
  ) {
    return { kind: "none" };
  }

  return {
    kind: "usage",
    usage: normalizedUsage,
    contextWindow: toNullableCount(entry.payload.info?.model_context_window)
  };
}

function isRolloutPromptEntry(entry: CodexRolloutEntry): boolean {
  return entry.payload?.type === USER_MESSAGE_TYPE || entry.type === "response_item";
}

function turnFromActivePrompt(
  prompt: ActiveCodexPrompt,
  options: CodexJsonlParserOptions
): TokenTurn {
  return {
    updateKey: prompt.updateKey,
    source: "codex",
    model: options.getModel?.() ?? options.model ?? UNKNOWN_MODEL,
    timestamp: prompt.timestamp,
    timestampIso: prompt.timestampIso,
    promptText: prompt.promptText,
    usage: prompt.usage,
    contextInputTokens: prompt.contextInputTokens,
    contextWindow: prompt.contextWindow
  };
}

function createEmptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0
  };
}

function addUsage(current: TokenUsage, next: TokenUsage): TokenUsage {
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    cachedInputTokens: current.cachedInputTokens + next.cachedInputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    reasoningTokens: current.reasoningTokens + next.reasoningTokens
  };
}

function extractUserPromptText(payload: NonNullable<CodexRolloutEntry["payload"]>): string | null {
  const promptText = extractPromptText(payload.message);
  if (!promptText) {
    return null;
  }

  if (promptText.length <= MIN_USER_PROMPT_LENGTH) {
    return null;
  }

  if (isBlockedPromptRole(payload.role) || isBlockedPromptSource(payload.source)) {
    return null;
  }

  if (INTERNAL_PROMPT_PATTERNS.some((pattern) => pattern.test(promptText))) {
    return null;
  }

  return promptText;
}

function extractPromptText(message: unknown): string | null {
  if (typeof message === "string") {
    return normalizePromptText(message);
  }

  if (Array.isArray(message)) {
    const textParts: string[] = [];
    for (const part of message) {
      if (!part || typeof part !== "object") {
        return null;
      }
      const candidate = part as { type?: unknown; text?: unknown };
      const type = typeof candidate.type === "string" ? candidate.type : "";
      if ((type === "input_text" || type === "text") && typeof candidate.text === "string") {
        textParts.push(candidate.text);
      }
    }
    return normalizePromptText(textParts.join("\n"));
  }

  return null;
}

function normalizePromptText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isBlockedPromptRole(value: unknown): boolean {
  return typeof value === "string" && BLOCKED_PROMPT_ROLES.has(value.toLowerCase());
}

function isBlockedPromptSource(value: unknown): boolean {
  return typeof value === "string" && BLOCKED_PROMPT_SOURCES.has(value.toLowerCase());
}

function findResponseCompletedEvent(value: unknown): CodexResponseCompletedEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as CodexResponseCompletedEvent & { payload?: unknown; event?: unknown; message?: unknown };
  if (candidate.type === RESPONSE_COMPLETED_TYPE && candidate.response?.usage) {
    return candidate;
  }

  for (const nested of [candidate.payload, candidate.event, candidate.message]) {
    const event = findResponseCompletedEvent(nested);
    if (event) {
      return event;
    }
  }

  return null;
}

function findUserPromptText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    type?: unknown;
    role?: unknown;
    source?: unknown;
    payload?: unknown;
    event?: unknown;
    message?: unknown;
    content?: unknown;
  };

  if (candidate.type === EVENT_MSG_TYPE && candidate.payload) {
    return findUserPromptText(candidate.payload);
  }

  if (candidate.type === USER_MESSAGE_TYPE) {
    return extractUserPromptText({
      type: USER_MESSAGE_TYPE,
      message: candidate.message,
      role: candidate.role,
      source: candidate.source
    });
  }

  if (candidate.type === "response_item" && candidate.payload) {
    return findUserPromptText(candidate.payload);
  }

  if (candidate.type === "message" && candidate.role === "user") {
    const promptText = extractPromptText(candidate.content);
    if (!promptText || promptText.length <= MIN_USER_PROMPT_LENGTH) {
      return null;
    }
    if (INTERNAL_PROMPT_PATTERNS.some((pattern) => pattern.test(promptText))) {
      return null;
    }
    return promptText;
  }

  for (const nested of [candidate.payload, candidate.event]) {
    const promptText = findUserPromptText(nested);
    if (promptText) {
      return promptText;
    }
  }

  return null;
}

function extractJsonPayload(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.startsWith(CODEX_MESSAGE_PREFIX)) {
    return trimmed.slice(CODEX_MESSAGE_PREFIX.length).trim();
  }

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  return null;
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

function toNullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
