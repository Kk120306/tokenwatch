import assert from "node:assert/strict";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { addToTotal, createEmptyTotal, formatSessionTotal, formatTurn } from "../dist/display.js";
import { estimateCostUsd, loadPricing } from "../dist/pricing.js";
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

test("bundled pricing includes current Codex GPT model rates", () => {
  const pricing = loadPricing();
  assert.equal(estimateCostUsd("gpt-5.5", {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 1000,
    reasoningTokens: 0
  }, pricing), 0.03525);
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
  insert.run("log", 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":20},"output_tokens":30}}}');
  insert.run("other", 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":999,"output_tokens":999}}}');

  const firstPoll = readCodexTurnsSince(db, baseline);
  assert.equal(firstPoll.lastRowId, 3);
  assert.equal(firstPoll.turns.length, 1);
  assert.equal(firstPoll.turns[0].source, "codex");
  assert.equal(firstPoll.turns[0].model, "gpt-5.5");
  assert.equal(firstPoll.turns[0].promptText, null);
  assert.ok(firstPoll.turns[0].timestamp instanceof Date);
  assert.deepEqual(firstPoll.turns[0].usage, {
    inputTokens: 120,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 0
  });

  const secondPoll = readCodexTurnsSince(db, firstPoll.lastRowId);
  assert.equal(secondPoll.lastRowId, 3);
  assert.deepEqual(secondPoll.turns, []);

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
