import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { renderCsvReport } from "../dist/export/csv.js";
import { renderMarkdownReport } from "../dist/export/markdown.js";
import { runExport } from "../dist/export/runner.js";

const pricing = {
  "gpt-5.5": {
    inputPerMillion: 1,
    cachedInputPerMillion: 0.1,
    outputPerMillion: 10
  },
  "claude-haiku-4-5": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.02,
    outputPerMillion: 1
  }
};

test("Markdown report renders grouped totals, prompt fallback, and chronological prompt log", () => {
  const report = renderMarkdownReport([
    parsedTurn({
      id: 2,
      timestampIso: "2026-05-18T11:00:00.000Z",
      model: "claude-haiku-4-5",
      source: "claude",
      promptText: null,
      inputTokens: 1000,
      cachedTokens: 500,
      outputTokens: 50,
      topic: null
    }),
    parsedTurn({
      id: 1,
      timestampIso: "2026-05-18T10:00:00.000Z",
      model: "gpt-5.5",
      source: "codex",
      promptText: "fix the auth middleware not passing headers ".repeat(8),
      inputTokens: 26_700,
      cachedTokens: 25_500,
      outputTokens: 167,
      reasoningTokens: 10,
      topic: "debugging"
    })
  ], pricing);

  assert.match(report, /^# tokenwatch session report/);
  assert.match(report, /\*\*Date:\*\* Monday May 18 2026 \| \*\*Duration:\*\* 1h 0m/);
  assert.match(report, /## By model/);
  assert.match(report, /\| gpt-5\.5 \| 1 \| ~\$0\.03 \| ~\$0\.031 \|/);
  assert.match(report, /## By topic/);
  assert.match(report, /### #1 — debugging — gpt-5\.5 — ~\$0\.03 — moderate/);
  assert.match(report, /> fix the auth middleware not passing headers/);
  assert.match(report, /\.\.\./);
  assert.match(report, /### #2 — uncategorized — claude-haiku-4-5/);
  assert.match(report, /> \*prompt text unavailable\*/);
});

test("CSV report quotes text and includes totals with overall cache hit rate", () => {
  const csv = renderCsvReport([
    parsedTurn({
      id: 1,
      timestampIso: "2026-05-18T10:00:00.000Z",
      model: "gpt-5.5",
      source: "codex",
      promptText: "fix, then say \"done\"",
      inputTokens: 100,
      cachedTokens: 25,
      outputTokens: 10,
      reasoningTokens: 3,
      topic: "debugging"
    }),
    parsedTurn({
      id: 2,
      timestampIso: "2026-05-18T10:01:00.000Z",
      model: "claude-haiku-4-5",
      source: "claude",
      promptText: null,
      inputTokens: 300,
      cachedTokens: 75,
      outputTokens: 30,
      topic: "building"
    })
  ], pricing);

  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "#,timestamp,model,source,topic,prompt_text,input_tokens,cached_tokens,output_tokens,reasoning_tokens,cost_usd,cost_label,cache_hit_rate,goal_id,goal_status,goal_tokens_used,goal_token_budget");
  assert.match(lines[1], /"fix, then say ""done"""/);
  assert.match(lines[2], /claude-haiku-4-5,claude,building,,300,75,30,0,/);
  assert.equal(lines[3], "TOTAL,,,,,,400,100,40,3,0.000294,,25.0%,,,,");
});

test("export runner reads the active Codex session from the start and appends filename counters", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const home = await makeTempDir();
  const codexHome = join(home, "codex");
  const claudeHome = join(home, "claude");
  const outDir = join(home, "reports");
  const rolloutPath = join(codexHome, "sessions", "2026", "05", "18", "rollout.jsonl");
  const logs = [];
  const originalLog = console.log;

  try {
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    await mkdir(join(codexHome, "sessions", "2026", "05", "18"), { recursive: true });
    await mkdir(claudeHome, { recursive: true });
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: "2026-05-18T10:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "build an export report"
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 0,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0
            }
          }
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 250,
              output_tokens: 50,
              reasoning_output_tokens: 5
            }
          }
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 2000,
              cached_input_tokens: 500,
              output_tokens: 70,
              reasoning_output_tokens: 9
            }
          }
        }
      })
    ].join("\n"), "utf8");
    createCodexState(join(codexHome, "state_5.sqlite"), rolloutPath);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "tokenwatch-2026-05-18.md"), "existing", "utf8");

    console.log = (message) => {
      logs.push(String(message));
    };

    await runExport(["--md", "--csv", "--out", outDir]);

    assert.deepEqual(logs, [
      "exported 1 prompts",
      `  → ${join(outDir, "tokenwatch-2026-05-18-2.md")}`,
      `  → ${join(outDir, "tokenwatch-2026-05-18.csv")}`
    ]);

    const markdown = await readFile(join(outDir, "tokenwatch-2026-05-18-2.md"), "utf8");
    const csv = await readFile(join(outDir, "tokenwatch-2026-05-18.csv"), "utf8");
    assert.match(markdown, /\*\*Prompts:\*\* 1/);
    assert.match(markdown, /\*\*Goal mode:\*\* active/);
    assert.match(markdown, /\*\*Goal objective:\*\* export goal metadata/);
    assert.match(markdown, /3k in · 750 cached · 120 out/);
    assert.match(csv, /^1,2026-05-18T10:00:00.000Z,gpt-5.5,codex,building,build an export report,3000,750,120,14,.*goal-1,active,4321,10000$/m);
  } finally {
    console.log = originalLog;
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

function parsedTurn(overrides) {
  const timestamp = new Date(overrides.timestampIso);
  const usage = {
    inputTokens: overrides.inputTokens,
    cachedInputTokens: overrides.cachedTokens,
    outputTokens: overrides.outputTokens,
    reasoningTokens: overrides.reasoningTokens ?? 0
  };
  const entry = pricing[overrides.model];
  const costUsd = entry
    ? (usage.inputTokens / 1_000_000) * entry.inputPerMillion +
      (usage.cachedInputTokens / 1_000_000) * entry.cachedInputPerMillion +
      (usage.outputTokens / 1_000_000) * entry.outputPerMillion
    : 0;
  return {
    updateKey: overrides.updateKey,
    id: overrides.id,
    timestamp,
    timestampIso: overrides.timestampIso,
    model: overrides.model,
    source: overrides.source,
    promptText: overrides.promptText,
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    costUsd,
    topic: overrides.topic,
    topicConfidence: overrides.topic ? "auto" : null,
    goal: overrides.goal ?? null
  };
}

async function makeTempDir() {
  const dir = join(tmpdir(), `tokenwatch-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function createCodexState(path, rolloutPath) {
  const db = new Database(path);
  db.exec(`
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
  db.prepare("INSERT INTO threads (id, rollout_path, model, updated_at_ms) VALUES (?, ?, ?, ?)").run("thread-1", rolloutPath, "gpt-5.5", now);
  db.prepare(`
    INSERT INTO thread_goals (thread_id, goal_id, objective, status, token_budget, tokens_used, time_used_seconds, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("thread-1", "goal-1", "export goal metadata", "active", 10000, 4321, 55, now);
  db.close();
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
