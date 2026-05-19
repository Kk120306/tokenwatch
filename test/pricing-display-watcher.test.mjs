import assert from "node:assert/strict";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { addToTotal, createEmptyTotal, formatSessionTotal, formatTurn } from "../dist/display.js";
import { createCodexSqliteParser } from "../dist/parsers/codex.js";
import { estimateCostUsd, getPricingFreshness, loadPricing, renderPricingInfo, resolvePricingModel } from "../dist/pricing.js";
import { findMostRecentSessionFile, getLatestCodexRowId, inspectPath, readCodexTurnsSince, startTokenWatcher } from "../dist/watcher.js";

test("pricing estimates known models and falls back to zero for unknown models", () => {
  const pricing = {
    "gpt-5": {
      inputPerMillion: 1,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 10
    }
  };
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 2000,
    outputTokens: 3000,
    reasoningTokens: 0
  };

  assert.equal(estimateCostUsd("gpt-5", usage, pricing), 0.032);
  assert.equal(estimateCostUsd("unknown", usage, pricing), 0);
});

test("pricing resolves date-suffixed model snapshots to bundled base keys", () => {
  const pricing = {
    "gpt-5.5": {
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 30
    },
    "claude-sonnet-4-6": {
      inputPerMillion: 3,
      cachedInputPerMillion: 0.3,
      outputPerMillion: 15
    }
  };
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 1000,
    reasoningTokens: 0
  };

  assert.deepEqual(resolvePricingModel("gpt-5.5-2026-05-01", pricing), {
    requestedModel: "gpt-5.5-2026-05-01",
    matchedModel: "gpt-5.5",
    exact: false
  });
  assert.deepEqual(resolvePricingModel("claude-sonnet-4-6-20260518", pricing), {
    requestedModel: "claude-sonnet-4-6-20260518",
    matchedModel: "claude-sonnet-4-6",
    exact: false
  });
  assert.equal(estimateCostUsd("gpt-5.5-2026-05-01", usage, pricing), 0.03525);
  assert.equal(estimateCostUsd("unknown-2026-05-01", usage, pricing), 0);
});

test("bundled pricing includes current Codex GPT model rates", () => {
  const pricing = loadPricing();
  assert.equal(estimateCostUsd("gpt-5.5", {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 1000,
    reasoningTokens: 0
  }, pricing), 0.03525);
  assert.equal(estimateCostUsd("codex-mini-latest", {
    inputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 0
  }, pricing), 7.875);
  assert.equal(estimateCostUsd("claude-opus-4-6", {
    inputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 0
  }, pricing), 30.5);
});

test("pricing freshness reports source verification age and stale status", () => {
  assert.deepEqual(getPricingFreshness(new Date("2026-05-18T12:00:00.000Z")), {
    verifiedAt: "2026-05-18",
    ageDays: 0,
    staleAfterDays: 90,
    stale: false,
    sources: [
      "https://openai.com/api/pricing/",
      "https://platform.openai.com/docs/pricing",
      "https://platform.claude.com/docs/en/about-claude/pricing"
    ]
  });
  assert.equal(getPricingFreshness(new Date("2026-08-17T00:00:00.000Z")).stale, true);

  const output = renderPricingInfo({
    "gpt-5": {
      inputPerMillion: 1.25,
      cachedInputPerMillion: 0.125,
      outputPerMillion: 10
    }
  }, new Date("2026-05-18T12:00:00.000Z"));
  assert.match(output, /Status: fresh \(0 days old; stale after 90 days\)/);
  assert.match(output, /date-suffixed snapshot IDs fall back/);
  assert.match(output, /https:\/\/openai\.com\/api\/pricing\//);
  assert.match(output, /gpt-5: input \$1.25 \/ cached \$0.125 \/ output \$10.00 per 1M tokens/);
});

test("display formats prompt rows and totals", () => {
  const turn = {
    source: "claude",
    model: "claude-sonnet-4-6",
    timestamp: new Date("2026-05-18T00:00:00.000Z"),
    timestampIso: "2026-05-18T00:00:00.000Z",
    promptText: "hello",
    index: 4,
    costUsd: 0.0023,
    usage: {
      inputTokens: 1842,
      cachedInputTokens: 1200,
      outputTokens: 347,
      reasoningTokens: 0
    }
  };

  const total = addToTotal(createEmptyTotal(), turn);
  assert.equal(
    formatTurn(turn),
    "[#4] in: 1,842  cached: 1,200  out: 347  ~$0.0023  claude-sonnet-4-6"
  );
  assert.match(formatSessionTotal(total), /session  in: 1,842  cached: 1,200  out: 347  ~\$0\.0023/);
});

test("active session detection chooses the newest candidate", async () => {
  const active = await findMostRecentSessionFile([
    { source: "claude", path: "old.jsonl", mtimeMs: 100 },
    { source: "codex", path: "new.sqlite", mtimeMs: 200 }
  ]);

  assert.deepEqual(active, { source: "codex", path: "new.sqlite", mtimeMs: 200 });
});

test("path inspection ignores missing paths and returns files", async () => {
  const dir = join(tmpdir(), `tokenwatch-${Date.now()}`);
  const path = join(dir, "session.jsonl");
  await mkdir(dir, { recursive: true });
  await writeFile(path, "{}\n", "utf8");

  const inspected = await inspectPath(path, "claude");
  assert.equal(inspected?.path, path);
  assert.equal(inspected?.source, "claude");
  assert.equal(await inspectPath(join(dir, "missing.jsonl"), "codex"), null);

  await rm(dir, { recursive: true, force: true });
});

test("Codex SQLite polling reads only response.completed rows newer than last rowid", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      ts_nanos INTEGER NOT NULL,
      level TEXT NOT NULL,
      target TEXT NOT NULL,
      feedback_log_body TEXT,
      module_path TEXT,
      file TEXT,
      line INTEGER,
      thread_id TEXT,
      process_uuid TEXT,
      estimated_bytes INTEGER NOT NULL DEFAULT 0
    );
  `);

  const insert = db.prepare(`
    INSERT INTO logs (ts, ts_nanos, level, target, feedback_log_body)
    VALUES (1, 1, 'TRACE', ?, ?)
  `);

  insert.run("log", "Received message {\"type\":\"response.output_item.done\"}");
  const baseline = getLatestCodexRowId(db);
  insert.run("log", 'Received message {"type":"event_msg","payload":{"type":"user_message","message":"fix the sqlite polling prompt mapping"}}');
  insert.run("log", 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":20},"output_tokens":30}}}');
  insert.run("other", 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":999,"output_tokens":999}}}');

  const parser = createCodexSqliteParser();
  const firstPoll = readCodexTurnsSince(db, baseline, parser.parseRow);
  assert.equal(firstPoll.lastRowId, 4);
  assert.equal(firstPoll.turns.length, 1);
  assert.equal(firstPoll.turns[0].source, "codex");
  assert.equal(firstPoll.turns[0].model, "gpt-5.5");
  assert.equal(firstPoll.turns[0].promptText, "fix the sqlite polling prompt mapping");
  assert.ok(firstPoll.turns[0].timestamp instanceof Date);
  assert.deepEqual(firstPoll.turns[0].usage, {
    inputTokens: 120,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 0
  });

  insert.run("log", 'Received message {"type":"event_msg","payload":{"type":"user_message","message":"continue mapping prompts across polls"}}');
  const promptOnlyPoll = readCodexTurnsSince(db, firstPoll.lastRowId, parser.parseRow);
  assert.equal(promptOnlyPoll.lastRowId, 5);
  assert.deepEqual(promptOnlyPoll.turns, []);

  insert.run("log", 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":10,"output_tokens":2}}}');
  const secondPoll = readCodexTurnsSince(db, promptOnlyPoll.lastRowId, parser.parseRow);
  assert.equal(secondPoll.lastRowId, 6);
  assert.equal(secondPoll.turns.length, 1);
  assert.equal(secondPoll.turns[0].promptText, "continue mapping prompts across polls");
  assert.deepEqual(secondPoll.turns[0].usage, {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 2,
    reasoningTokens: 0
  });

  db.close();
});

test("Claude JSONL watcher tails from startup offset and ignores historical turns", async () => {
  const dir = join(tmpdir(), `tokenwatch-tail-${Date.now()}`);
  const path = join(dir, "session.jsonl");
  const codexDbPath = join(dir, "logs_2.sqlite");
  const turns = [];
  let watcher;

  try {
    await mkdir(dir, { recursive: true });
    createEmptyCodexLogs(codexDbPath);
    await writeFile(path, [
      JSON.stringify({ type: "user", message: { content: "historical prompt" } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 10 } } }),
      ""
    ].join("\n"), "utf8");

    watcher = await startTokenWatcher((turn) => turns.push(turn), {
      claudeGlob: path,
      codexDbPath,
      pollIntervalMs: 10,
      detectionIntervalMs: 10_000,
      logger: () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(turns, []);

    await appendFile(path, [
      JSON.stringify({ type: "user", message: { content: "new prompt" } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 200, output_tokens: 20 } } }),
      ""
    ].join("\n"), "utf8");

    await waitFor(() => turns.length === 1);
    assert.equal(turns[0].promptText, "new prompt");
    assert.deepEqual(turns[0].usage, {
      inputTokens: 200,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningTokens: 0
    });
  } finally {
    await watcher?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude JSONL watcher starts empty when restarted with existing session turns", async () => {
  const dir = join(tmpdir(), `tokenwatch-restart-${Date.now()}`);
  const path = join(dir, "session.jsonl");
  const codexDbPath = join(dir, "logs_2.sqlite");

  try {
    await mkdir(dir, { recursive: true });
    createEmptyCodexLogs(codexDbPath);
    await writeFile(path, [
      JSON.stringify({ type: "user", message: { content: "previous session prompt" } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 10 } } }),
      ""
    ].join("\n"), "utf8");

    for (let run = 0; run < 2; run += 1) {
      const turns = [];
      const watcher = await startTokenWatcher((turn) => turns.push(turn), {
        claudeGlob: path,
        codexDbPath,
        pollIntervalMs: 10,
        detectionIntervalMs: 10_000,
        logger: () => {}
      });

      try {
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.deepEqual(turns, []);
      } finally {
        await watcher.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude JSONL watcher discards duplicate turns within the dedupe window", async () => {
  const dir = join(tmpdir(), `tokenwatch-dedupe-${Date.now()}`);
  const path = join(dir, "session.jsonl");
  const codexDbPath = join(dir, "logs_2.sqlite");
  const turns = [];
  let watcher;

  const duplicateTurnLines = [
    JSON.stringify({ type: "user", message: { content: "duplicate prompt" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-05-18T00:00:00.000Z", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 3, cache_read_input_tokens: 19_600, output_tokens: 166 } } }),
    JSON.stringify({ type: "user", message: { content: "same token counts in the same timestamp bucket" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-05-18T00:00:04.999Z", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 3, cache_read_input_tokens: 19_600, output_tokens: 166 } } }),
    ""
  ].join("\n");

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, "", "utf8");
    createEmptyCodexLogs(codexDbPath);

    watcher = await startTokenWatcher((turn) => turns.push(turn), {
      claudeGlob: path,
      codexDbPath,
      pollIntervalMs: 10,
      detectionIntervalMs: 10_000,
      logger: () => {}
    });

    await appendFile(path, duplicateTurnLines, "utf8");
    await waitFor(() => turns.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(turns.length, 1);
    assert.equal(turns[0].promptText, "duplicate prompt");
    assert.deepEqual(turns[0].usage, {
      inputTokens: 3,
      cachedInputTokens: 19600,
      outputTokens: 166,
      reasoningTokens: 0
    });
  } finally {
    await watcher?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("JSONL watcher detects appends after the initial scan with default polling", async () => {
  const dir = join(tmpdir(), `tokenwatch-settled-${Date.now()}`);
  const path = join(dir, "session.jsonl");
  const codexDbPath = join(dir, "logs_2.sqlite");
  const turns = [];
  let watcher;

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, "", "utf8");
    createEmptyCodexLogs(codexDbPath);

    watcher = await startTokenWatcher((turn) => turns.push(turn), {
      claudeGlob: path,
      codexDbPath,
      logger: () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await appendFile(path, [
      JSON.stringify({ type: "user", message: { content: "new prompt after startup" } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 200_000, output_tokens: 20_000 } } }),
      ""
    ].join("\n"), "utf8");

    await waitFor(() => turns.length === 1, 3000);
    assert.equal(turns[0].promptText, "new prompt after startup");
    assert.equal(turns[0].model, "claude-sonnet-4-6");
  } finally {
    await watcher?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex state watcher tails startup rollout but reads a new mid-session thread from byte zero", async () => {
  const dir = join(tmpdir(), `tokenwatch-codex-rollout-${Date.now()}`);
  const statePath = join(dir, "state_5.sqlite");
  const oldRolloutPath = join(dir, "old-rollout.jsonl");
  const newRolloutPath = join(dir, "new-rollout.jsonl");
  const turns = [];
  let watcher;

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(oldRolloutPath, `${codexUserMessageLine("old prompt text")}\n${codexTokenCountLine(100, 10)}\n`, "utf8");
    await writeFile(newRolloutPath, `${codexUserMessageLine("new prompt text")}\n${codexTokenCountLine(250, 25)}\n`, "utf8");

    const initialDb = new Database(statePath);
    initialDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT,
        model TEXT,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE thread_goals (
        thread_id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        time_used_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    initialDb.prepare("INSERT INTO threads (id, rollout_path, model, updated_at_ms) VALUES (?, ?, ?, ?)").run("old-thread", oldRolloutPath, "gpt-5", now);
    initialDb.close();

    watcher = await startTokenWatcher((turn) => turns.push(turn), {
      claudeGlob: join(dir, "missing-claude.jsonl"),
      codexDbPath: statePath,
      pollIntervalMs: 10,
      detectionIntervalMs: 25,
      logger: () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.deepEqual(turns, []);

    const updatedDb = new Database(statePath);
    updatedDb.prepare("INSERT INTO threads (id, rollout_path, model, updated_at_ms) VALUES (?, ?, ?, ?)").run("new-thread", newRolloutPath, "gpt-5.5", now + 1);
    updatedDb.prepare(`
      INSERT INTO thread_goals (thread_id, goal_id, objective, status, token_budget, tokens_used, time_used_seconds, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("new-thread", "goal-1", "finish tokenwatch goal detection", "active", 5000, 1250, 30, now + 1);
    updatedDb.close();

    await waitFor(() => turns.length === 1);
    assert.equal(turns[0].model, "gpt-5.5");
    assert.deepEqual(turns[0].usage, {
      inputTokens: 250,
      cachedInputTokens: 0,
      outputTokens: 25,
      reasoningTokens: 0
    });
    assert.deepEqual(turns[0].goal, {
      goalId: "goal-1",
      objective: "finish tokenwatch goal detection",
      status: "active",
      tokenBudget: 5000,
      tokensUsed: 1250,
      timeUsedSeconds: 30
    });
  } finally {
    await watcher?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex watcher promotes from SQLite fallback to rollout JSONL when state appears", async () => {
  const originalCodexHome = process.env.CODEX_HOME;
  const dir = join(tmpdir(), `tokenwatch-codex-promote-${Date.now()}`);
  const codexHome = join(dir, "codex");
  const logsPath = join(codexHome, "logs_2.sqlite");
  const statePath = join(codexHome, "state_5.sqlite");
  const rolloutPath = join(codexHome, "sessions", "2026", "05", "18", "rollout.jsonl");
  const turns = [];
  const logs = [];
  let watcher;

  try {
    process.env.CODEX_HOME = codexHome;
    await mkdir(join(codexHome, "sessions", "2026", "05", "18"), { recursive: true });
    createEmptyCodexLogs(logsPath);

    watcher = await startTokenWatcher((turn) => turns.push(turn), {
      claudeGlob: join(dir, "missing-claude.jsonl"),
      pollIntervalMs: 10,
      detectionIntervalMs: 25,
      logger: (message) => logs.push(message)
    });

    await waitFor(() => logs.includes("tokenwatch: codex → sqlite ✓"));

    await writeFile(
      rolloutPath,
      `${codexUserMessageLine("promote to richer rollout prompt text")}\n${codexTokenCountLine(300, 30)}\n`,
      "utf8"
    );
    createCodexState(statePath, rolloutPath, "gpt-5.5");

    await waitFor(() => turns.some((turn) => turn.sourceFormat === "jsonl"));
    const promotedTurn = turns.find((turn) => turn.sourceFormat === "jsonl");
    assert.equal(promotedTurn.model, "gpt-5.5");
    assert.equal(promotedTurn.promptText, "promote to richer rollout prompt text");
    assert.deepEqual(promotedTurn.usage, {
      inputTokens: 300,
      cachedInputTokens: 0,
      outputTokens: 30,
      reasoningTokens: 0
    });
    assert.ok(logs.includes("tokenwatch: codex → rollout jsonl ✓"));
  } finally {
    await watcher?.close();
    restoreEnv("CODEX_HOME", originalCodexHome);
    await rm(dir, { recursive: true, force: true });
  }
});

function codexTokenCountLine(inputTokens, outputTokens) {
  return JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens
        }
      }
    }
  });
}

function codexUserMessageLine(message) {
  return JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message
    }
  });
}

function createEmptyCodexLogs(path) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      feedback_log_body TEXT
    );
  `);
  db.close();
}

function createCodexState(path, rolloutPath, model) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      model TEXT,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO threads (id, rollout_path, model, updated_at_ms) VALUES (?, ?, ?, ?)")
    .run("thread-1", rolloutPath, model, Date.now());
  db.close();
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("timed out waiting for condition");
}
