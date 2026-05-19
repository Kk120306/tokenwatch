import assert from "node:assert/strict";
import test from "node:test";
import { formatDetectionLines, formatFooterStatus, formatSourceHealthStatus, getPromptViewport, selectedFilters, shortcutLineForWidth, unselectedFilters } from "../dist/ui/App.js";
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

test("TUI onboarding diagnostics explain missing, waiting, and found sources", () => {
  assert.deepEqual(formatDetectionLines("Claude Code", undefined), [
    "  ?  Claude Code   checking storage",
    "     Waiting for the first detection pass."
  ]);

  assert.deepEqual(formatDetectionLines("Codex CLI", {
    source: "codex",
    status: "missing",
    format: "none",
    path: null,
    paths: [],
    detail: "codex → waiting for session...",
    warnings: ["~/.codex/state_5.sqlite: no readable Codex rollout path in threads.rollout_path; falling back"]
  }), [
    "  ✗  Codex CLI     not detected",
    "     Codex state found; waiting for an active session to write a rollout path.",
    "     Warning: ~/.codex/state_5.sqlite: no readable Codex rollout path in threads.rollout_path; falling back"
  ]);

  assert.deepEqual(formatDetectionLines("Codex CLI", {
    source: "codex",
    status: "found",
    format: "sqlite",
    path: "/tmp/logs_2.sqlite",
    paths: ["/tmp/logs_2.sqlite"],
    detail: "$CODEX_HOME/logs_2.sqlite",
    warnings: []
  }), [
    "  ✓  Codex CLI     /tmp/logs_2.sqlite   sqlite",
    "     Usage is available; prompt text is best-effort from nearby user-message telemetry."
  ]);
});

test("TUI source health status summarizes ready, partial, limited, and degraded sources", () => {
  assert.deepEqual(formatSourceHealthStatus(null), {
    severity: "checking",
    text: "Sources: checking"
  });

  const missingClaude = {
    source: "claude",
    status: "missing",
    format: "none",
    path: null,
    paths: [],
    detail: "not detected",
    warnings: []
  };
  const codexJsonl = {
    source: "codex",
    status: "found",
    format: "jsonl",
    path: "/tmp/rollout.jsonl",
    paths: ["/tmp/rollout.jsonl"],
    detail: "rollout",
    warnings: []
  };
  const codexSqlite = {
    ...codexJsonl,
    format: "sqlite",
    path: "/tmp/logs_2.sqlite",
    paths: ["/tmp/logs_2.sqlite"],
    detail: "sqlite"
  };
  const claudeJsonl = {
    source: "claude",
    status: "found",
    format: "jsonl",
    path: "/tmp/claude.jsonl",
    paths: ["/tmp/claude.jsonl"],
    detail: "claude",
    warnings: []
  };

  assert.deepEqual(formatSourceHealthStatus({
    claude: missingClaude,
    codex: { ...missingClaude, source: "codex" }
  }), {
    severity: "missing",
    text: "Sources: missing (Claude Code, Codex CLI)"
  });
  assert.deepEqual(formatSourceHealthStatus({
    claude: missingClaude,
    codex: codexJsonl
  }), {
    severity: "partial",
    text: "Sources: partial (Codex CLI jsonl; missing Claude Code)"
  });
  assert.deepEqual(formatSourceHealthStatus({
    claude: missingClaude,
    codex: codexSqlite
  }), {
    severity: "limited",
    text: "Sources: limited (Codex CLI sqlite; Codex prompt text best-effort)"
  });
  assert.deepEqual(formatSourceHealthStatus({
    claude: claudeJsonl,
    codex: { ...codexJsonl, warnings: ["schema drift"] }
  }, ["schema drift"]), {
    severity: "degraded",
    text: "Sources: degraded (Claude Code jsonl, Codex CLI jsonl; 1 warning)"
  });
  assert.deepEqual(formatSourceHealthStatus({
    claude: claudeJsonl,
    codex: codexJsonl
  }), {
    severity: "ready",
    text: "Sources: ready (Claude Code jsonl, Codex CLI jsonl)"
  });
});

test("TUI footer status and shortcuts stay useful in narrow terminals", () => {
  assert.equal(formatFooterStatus({
    activeView: "prompts",
    visiblePrompts: 2,
    totalPrompts: 3,
    totalCostUsd: 0.052,
    promptSortMode: "cacheGrade",
    modelFilterCount: 2,
    topicFilterCount: 3,
    showTokens: false
  }), "View: prompts | prompts: 2/3 | cost: ~$0.05 | sort: cache grade | filters: 2 models, 3 topics | tokens: cost");
  assert.match(shortcutLineForWidth(80), /\[f\/t\] Filters/);
  assert.doesNotMatch(shortcutLineForWidth(80), /Cache sort/);
  assert.match(shortcutLineForWidth(140), /Cache sort/);
});

test("TUI prompt viewport keeps the selected prompt visible in long sessions", () => {
  const longTurns = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    contextUsagePct: index % 2 === 0 ? 0.5 : null,
    goal: null
  }));

  const middle = getPromptViewport(longTurns, 8, null, 10);
  assert.ok(middle.startIndex > 0);
  assert.ok(middle.startIndex <= 8);
  assert.ok(middle.endIndex > 8);
  assert.ok(middle.endIndex < longTurns.length);
  assert.equal(middle.hiddenBefore, middle.startIndex);
  assert.equal(middle.hiddenAfter, longTurns.length - middle.endIndex);

  const top = getPromptViewport(longTurns, 0, null, 10);
  assert.equal(top.startIndex, 0);
  assert.ok(top.endIndex > 0);

  const bottom = getPromptViewport(longTurns, longTurns.length - 1, null, 10);
  assert.ok(bottom.startIndex < longTurns.length - 1);
  assert.equal(bottom.endIndex, longTurns.length);
});

test("TUI prompt viewport accounts for expanded prompt height", () => {
  const longTurns = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    contextUsagePct: null,
    goal: index === 2 ? { goalId: "goal", objective: "", status: "active", tokenBudget: null, tokensUsed: 1, timeUsedSeconds: 1 } : null
  }));

  const collapsed = getPromptViewport(longTurns, 2, null, 12);
  const expanded = getPromptViewport(longTurns, 2, 3, 12);

  assert.ok(collapsed.endIndex - collapsed.startIndex > expanded.endIndex - expanded.startIndex);
  assert.ok(expanded.startIndex <= 2);
  assert.ok(expanded.endIndex > 2);
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
  assert.equal(stats.cacheEfficiency.overallGrade, "C");
  assert.equal(stats.cacheEfficiency.bestTopic.topic, "debugging");
  assert.equal(stats.cacheEfficiency.worstTopic.topic, "refactoring");
});

test("TUI cache efficiency tips change for low and high cache sessions", () => {
  const lowCache = summarizeStats([
    { ...turns[0], cachedTokens: 0 },
    { ...turns[1], cachedTokens: 100 },
    { ...turns[2], cachedTokens: 0 }
  ], {});
  const highCache = summarizeStats([
    { ...turns[0], cachedTokens: 900 },
    { ...turns[1], cachedTokens: 1800 },
    { ...turns[2], cachedTokens: 900 }
  ], {});

  assert.equal(lowCache.cacheEfficiency.overallGrade, "F");
  assert.match(lowCache.cacheEfficiency.tip, /continuing sessions/);
  assert.equal(highCache.cacheEfficiency.overallGrade, "A");
  assert.match(highCache.cacheEfficiency.tip, /Great cache usage/);
  assert.notEqual(lowCache.cacheEfficiency.tip, highCache.cacheEfficiency.tip);
});

test("TUI stats summarize context window usage", () => {
  const contextTurns = [
    { ...turns[0], contextWindow: 128000, contextUsagePct: 0.25 },
    { ...turns[1], contextWindow: 128000, contextUsagePct: 0.82 },
    { ...turns[2], contextWindow: 128000, contextUsagePct: 0.94 }
  ];
  const stats = summarizeStats(contextTurns, {});

  assert.equal(stats.contextWindow.averageUsagePct, (0.25 + 0.82 + 0.94) / 3);
  assert.equal(stats.contextWindow.highestTurn.id, 3);
  assert.equal(stats.contextWindow.over75Count, 2);
  assert.equal(stats.contextWindow.over90Count, 1);
  assert.match(stats.contextWindow.tip, /Prompt #3/);
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
