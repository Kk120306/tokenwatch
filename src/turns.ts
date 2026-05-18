import { resolveTurnTopic } from "./classifier.js";
import { estimateCostUsd } from "./pricing.js";
import type { ParsedTurn, PricingTable, TokenTurn } from "./types.js";

export function createParsedTurn(
  turn: TokenTurn,
  id: number,
  pricing: PricingTable,
  manualTopic?: string
): ParsedTurn {
  const topic = resolveTurnTopic(turn.promptText, manualTopic);
  const model = normalizeModel(turn.model);
  return {
    updateKey: turn.updateKey,
    id,
    timestamp: turn.timestamp,
    timestampIso: turn.timestampIso ?? turn.timestamp.toISOString(),
    model,
    source: turn.source,
    promptText: turn.promptText,
    inputTokens: turn.usage.inputTokens,
    cachedTokens: turn.usage.cachedInputTokens,
    outputTokens: turn.usage.outputTokens,
    reasoningTokens: turn.usage.reasoningTokens,
    costUsd: estimateCostUsd(model, turn.usage, pricing),
    topic: topic.topic,
    topicConfidence: topic.topicConfidence
  };
}

function normalizeModel(model: unknown): string {
  return typeof model === "string" && model.trim().length > 0
    ? model
    : "unknown";
}
