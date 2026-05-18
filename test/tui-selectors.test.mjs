import assert from "node:assert/strict";
import test from "node:test";
import { selectedFilters, unselectedFilters } from "../dist/ui/App.js";
import { filterTurns, normalizeModel, recommendModel, summarizeModels, summarizeStats, uniqueModels } from "../dist/ui/selectors.js";

const turns = [
  {
    id: 1,
    timestamp: new Date("2026-05-18T00:00:00.000Z"),
    timestampIso: "2026-05-18T00:00:00.000Z",
    model: "claude-haiku-4-5",
    source: "claude",
    promptText: "fix bug",
    inputTokens: 1000,
    cachedTokens: 600,
    outputTokens: 200,
    reasoningTokens: 0,
    costUsd: 0.002,
    topic: "debugging",
    topicConfidence: "auto"
  },
  {
    id: 2,
    timestamp: new Date("2026-05-18T01:00:00.000Z"),
    timestampIso: "2026-05-18T01:00:00.000Z",
    model: "gpt-5.5",
    source: "codex",
    promptText: "add feature",
    inputTokens: 2000,
    cachedTokens: 1000,
    outputTokens: 500,
    reasoningTokens: 100,
    costUsd: 0.03,
    topic: "building",
    topicConfidence: "auto"
  },
  {
    id: 3,
    timestamp: new Date("2026-05-18T01:30:00.000Z"),
    timestampIso: "2026-05-18T01:30:00.000Z",
    model: "gpt-5.5",
    source: "codex",
    promptText: "refactor parser",
    inputTokens: 1000,
    cachedTokens: 0,
    outputTokens: 300,
    reasoningTokens: 50,
    costUsd: 0.02,
    topic: "refactoring",
    topicConfidence: "auto"
  }
];

test("TUI filters combine model and topic selections independently", () => {
  assert.deepEqual(
    filterTurns(turns, ["gpt-5.5"], ["building"]).map((turn) => turn.id),
    [2]
  );
  assert.deepEqual(
    filterTurns(turns, ["gpt-5.5"], ["building", "refactoring"]).map((turn) => turn.id),
    [2, 3]
  );
  assert.deepEqual(filterTurns(turns, [], ["building"]).map((turn) => turn.id), []);
});

test("TUI filter selections default newly discovered models and topics to selected", () => {
  assert.deepEqual(selectedFilters(["gpt-5.5", "claude-sonnet-4-6"], []), [
    "gpt-5.5",
    "claude-sonnet-4-6"
  ]);
  const unchecked = unselectedFilters(["gpt-5.5", "claude-sonnet-4-6"], ["gpt-5.5"]);
  assert.deepEqual(unchecked, ["claude-sonnet-4-6"]);
  assert.deepEqual(selectedFilters(["gpt-5.5", "claude-sonnet-4-6", "gpt-5.4"], unchecked), ["gpt-5.5", "gpt-5.4"]);
});

test("TUI prompts stay flat by timestamp and model rendering falls back to unknown", () => {
  const mixedTurns = [
    { ...turns[2], timestamp: new Date("2026-05-18T02:00:00.000Z") },
    { ...turns[0], model: null, timestamp: new Date("2026-05-18T00:30:00.000Z") },
    { ...turns[1], timestamp: new Date("2026-05-18T01:00:00.000Z") }
  ];

  assert.deepEqual(
    filterTurns(mixedTurns, ["unknown", "gpt-5.5"], ["debugging", "building", "refactoring"]).map((turn) => turn.id),
    [1, 2, 3]
  );
  assert.deepEqual(uniqueModels(mixedTurns), ["gpt-5.5", "unknown"]);
  assert.equal(normalizeModel(undefined), "unknown");
  assert.equal(summarizeModels(mixedTurns).some((summary) => summary.model === "unknown"), true);
});

test("TUI model summaries produce a clear cheaper-model recommendation", () => {
  const models = summarizeModels(turns);
  const recommendation = recommendModel(models);
  const gpt = models.find((model) => model.model === "gpt-5.5");

  assert.equal(gpt.promptCount, 2);
  assert.equal(gpt.inputTokens, 3000);
  assert.equal(gpt.reasoningTokens, 150);
  assert.match(recommendation.text, /claude-haiku-4-5/);
  assert.match(recommendation.text, /cheaper\/prompt/);
});

test("TUI stats include cache savings and per-topic breakdowns", () => {
  const pricing = {
    "claude-haiku-4-5": {
      inputPerMillion: 1,
      cachedInputPerMillion: 0.2,
      outputPerMillion: 5
    },
    "gpt-5.5": {
      inputPerMillion: 10,
      cachedInputPerMillion: 1,
      outputPerMillion: 30
    }
  };
  const stats = summarizeStats(turns, pricing);

  assert.equal(stats.totalPrompts, 3);
  assert.equal(stats.mostExpensiveTurn.id, 2);
  assert.equal(stats.mostExpensiveTopic.topic, "building");
  assert.equal(stats.cheapestTopic.topic, "debugging");
  assert.equal(stats.topTopics.length, 3);
  assert.ok(stats.cacheSavingsUsd > 0);
  assert.equal(stats.cacheHitRate, 1600 / 4000);
});

test("TUI stats summarize goal-mode metadata from parsed turns", () => {
  const goal = {
    goalId: "goal-1",
    objective: "implement goal mode usage",
    status: "active",
    tokenBudget: 10000,
    tokensUsed: 2500,
    timeUsedSeconds: 90
  };
  const stats = summarizeStats([
    { ...turns[0], goal: null },
    { ...turns[1], goal },
    { ...turns[2], goal }
  ], {});

  assert.deepEqual(stats.goal, {
    ...goal,
    promptCount: 2
  });
});
