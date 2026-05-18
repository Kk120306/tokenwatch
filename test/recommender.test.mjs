import assert from "node:assert/strict";
import test from "node:test";
import { modelNickname, recommendModels } from "../dist/recommender.js";

function turn(id, topic, model, costUsd) {
  return {
    id,
    timestamp: new Date(`2026-05-18T00:0${id}:00.000Z`),
    timestampIso: `2026-05-18T00:0${id}:00.000Z`,
    model,
    source: model.startsWith("claude") ? "claude" : "codex",
    promptText: "prompt",
    inputTokens: 1000,
    cachedTokens: 500,
    cacheGrade: "C",
    cacheHitRate: 0.5,
    cacheSavingsUsd: 0.001,
    outputTokens: 100,
    reasoningTokens: 0,
    costUsd,
    topic,
    topicConfidence: "auto",
    goal: null
  };
}

test("model recommender compares only observed models by topic", () => {
  const recommendations = recommendModels([
    turn(1, "debugging", "gpt-5.5", 0.03),
    turn(2, "debugging", "gpt-5.5", 0.03),
    turn(3, "debugging", "claude-haiku-4-5-20251001", 0.005),
    turn(4, "learning", "claude-haiku-4-5-20251001", 0.004),
    turn(5, "learning", "claude-haiku-4-5-20251001", 0.006)
  ]);

  const debugging = recommendations.find((recommendation) => recommendation.topic === "debugging");
  const learning = recommendations.find((recommendation) => recommendation.topic === "learning");

  assert.equal(debugging.currentModel, "gpt-5.5");
  assert.equal(debugging.cheaperModel, "claude-haiku-4-5-20251001");
  assert.equal(debugging.alreadyOptimal, false);
  assert.equal(debugging.potentialSavingUsd, 0.075);
  assert.ok(Math.abs(debugging.potentialSavingPct - (0.025 / 0.03)) < 0.000001);
  assert.equal(learning.alreadyOptimal, true);
  assert.equal(learning.cheaperModel, null);
  assert.equal(recommendations.some((recommendation) => recommendation.cheaperModel === "gpt-5-mini"), false);
});

test("model nicknames use plain English labels when known", () => {
  assert.equal(modelNickname("claude-haiku-4-5-20251001"), "claude-haiku (fast, cheap)");
  assert.equal(modelNickname("claude-sonnet-4-6"), "claude-sonnet (balanced)");
  assert.equal(modelNickname("custom-model"), "custom-model");
});
