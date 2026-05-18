import type { CodexLogRow, CodexResponseCompletedEvent, TokenTurn, TokenUsage } from "../types.js";

const UNKNOWN_MODEL = "unknown";
const CODEX_MESSAGE_PREFIX = "Received message ";
const RESPONSE_COMPLETED_TYPE = "response.completed";

export function parseCodexLogRow(row: CodexLogRow): TokenTurn | null {
  return parseCodexFeedbackLogBody(row.feedback_log_body);
}

export function parseCodexFeedbackLogBody(body: string | null): TokenTurn | null {
  if (!body) {
    return null;
  }

  const payload = extractJsonPayload(body);
  if (!payload) {
    return null;
  }

  let event: CodexResponseCompletedEvent;
  try {
    event = JSON.parse(payload) as CodexResponseCompletedEvent;
  } catch {
    return null;
  }

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
    outputTokens: toCount(usage.output_tokens)
  };

  if (
    normalizedUsage.inputTokens === 0 &&
    normalizedUsage.cachedInputTokens === 0 &&
    normalizedUsage.outputTokens === 0
  ) {
    return null;
  }

  return {
    source: "codex",
    model: event.response?.model ?? UNKNOWN_MODEL,
    usage: normalizedUsage
  };
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

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
