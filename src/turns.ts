import { scoreCacheEfficiency } from "./cache-score.js";
import { resolveTurnTopic } from "./classifier.js";
import { getContextUsagePct, getContextWindow } from "./context-windows.js";
import { estimateCostUsd } from "./pricing.js";
import type { ParsedTurn, PricingTable, TokenTurn, TopicRuleConfig } from "./types.js";

export function createParsedTurn(
  turn: TokenTurn,
  id: number,
  pricing: PricingTable,
  manualTopic?: string,
  configuredTopicRules: readonly TopicRuleConfig[] = []
): ParsedTurn {
  const topic = resolveTurnTopic(turn.promptText, manualTopic, configuredTopicRules);
  const model = normalizeModel(turn.model);
  const cacheScore = scoreCacheEfficiency({
    model,
    inputTokens: turn.usage.inputTokens,
    cachedTokens: turn.usage.cachedInputTokens
  }, pricing);
  const contextWindow = turn.contextWindow ?? getContextWindow(model);
  const contextInputTokens = turn.contextInputTokens ?? turn.usage.inputTokens;
  const contextUsagePct = getContextUsagePct(contextInputTokens, contextWindow);
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
    cacheGrade: cacheScore.cacheGrade,
    cacheHitRate: cacheScore.cacheHitRate,
    cacheSavingsUsd: cacheScore.cacheSavingsUsd,
    contextWindow,
    contextUsagePct,
    outputTokens: turn.usage.outputTokens,
    reasoningTokens: turn.usage.reasoningTokens,
    costUsd: estimateCostUsd(model, turn.usage, pricing),
    topic: topic.topic,
    topicConfidence: topic.topicConfidence,
    goal: turn.goal ?? null
  };
}

function normalizeModel(model: unknown): string {
  return typeof model === "string" && model.trim().length > 0
    ? model
    : "unknown";
}
