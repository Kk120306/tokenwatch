import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addToTotal, createEmptyTotal, formatSessionTotal, formatTurn } from "../dist/display.js";
import { estimateCostUsd } from "../dist/pricing.js";
import { findMostRecentSessionFile, inspectPath } from "../dist/watcher.js";

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
    { source: "codex", path: "new.jsonl", mtimeMs: 200 }
  ]);

  assert.deepEqual(active, { source: "codex", path: "new.jsonl", mtimeMs: 200 });
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
