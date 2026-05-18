import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { addToTotal, createEmptyTotal, formatSessionTotal, formatTurn } from "../dist/display.js";
import { estimateCostUsd } from "../dist/pricing.js";
import { findMostRecentSessionFile, getLatestCodexRowId, inspectPath, readCodexTurnsSince } from "../dist/watcher.js";

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
    outputTokens: 3000
  };

  assert.equal(estimateCostUsd("gpt-5", usage, pricing), 0.032);
  assert.equal(estimateCostUsd("unknown", usage, pricing), 0);
});

test("display formats prompt rows and totals", () => {
  const turn = {
    source: "claude",
    model: "claude-sonnet-4-6",
    index: 4,
    costUsd: 0.0023,
    usage: {
      inputTokens: 1842,
      cachedInputTokens: 1200,
      outputTokens: 347
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
  assert.deepEqual(firstPoll.turns, [
    {
      source: "codex",
      model: "gpt-5.5",
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 30
      }
    }
  ]);

  const secondPoll = readCodexTurnsSince(db, firstPoll.lastRowId);
  assert.equal(secondPoll.lastRowId, 3);
  assert.deepEqual(secondPoll.turns, []);

  db.close();
});
