import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { renderCsvReport } from "../dist/export/csv.js";
import { renderJsonReport } from "../dist/export/json.js";
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
  assert.match(report, /## By source/);
  assert.match(report, /\| codex \| 1 \| ~\$0\.03 \| ~\$0\.031 \| 99% \|/);
  assert.match(report, /## By topic/);
  assert.match(report, /## Costliest prompts/);
  assert.match(report, /\| 1 \| codex jsonl \| debugging \| gpt-5\.5 \| ~\$0\.03 \| 99% \| fix the auth middleware not passing headers/);
  assert.match(report, /### #1 — debugging — gpt-5\.5 — ~\$0\.03 — moderate/);
  assert.match(report, /\*\*Source:\*\* codex jsonl \| \*\*Prompt visibility:\*\* prompt text paired with usage/);
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
  assert.equal(lines[0], "#,timestamp,model,source,source_format,prompt_visibility,topic,prompt_text,input_tokens,cached_tokens,output_tokens,reasoning_tokens,cost_usd,cost_label,cache_hit_rate,goal_id,goal_status,goal_tokens_used,goal_token_budget");
  assert.match(lines[1], /"fix, then say ""done"""/);
  assert.match(lines[2], /claude-haiku-4-5,claude,jsonl,usage-only,building,,300,75,30,0,/);
  assert.equal(lines[3], "TOTAL,,,,,,,,400,100,40,3,0.000294,,25.0%,,,,");
});

test("JSON report exposes stable summary, grouping, and prompt fields", () => {
  const report = JSON.parse(renderJsonReport([
    parsedTurn({
      id: 1,
      timestampIso: "2026-05-18T10:00:00.000Z",
      model: "gpt-5.5",
      source: "codex",
      promptText: "export this prompt",
      inputTokens: 100,
      cachedTokens: 25,
      outputTokens: 10,
      reasoningTokens: 3,
      topic: "debugging",
      goal: {
        goalId: "goal-json",
        objective: "structured exports",
        status: "active",
        tokenBudget: 1000,
        tokensUsed: 250,
        timeUsedSeconds: 15
      }
    }),
    parsedTurn({
      id: 2,
      timestampIso: "2026-05-18T10:05:00.000Z",
      model: "gpt-5.5",
      source: "codex",
      promptText: null,
      inputTokens: 300,
      cachedTokens: 75,
      outputTokens: 30,
      topic: null
    })
  ], pricing));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.summary.prompts, 2);
  assert.equal(report.summary.startedAt, "2026-05-18T10:00:00.000Z");
  assert.equal(report.summary.endedAt, "2026-05-18T10:05:00.000Z");
  assert.equal(report.summary.totals.inputTokens, 400);
  assert.equal(report.summary.goal.goalId, "goal-json");
  assert.equal(report.summary.mostExpensivePrompt.index, 2);
  assert.equal(report.summary.mostExpensivePrompt.promptVisibility, "usage-only");
  assert.deepEqual(report.byModel.map((group) => [group.name, group.prompts]), [["gpt-5.5", 2]]);
  assert.deepEqual(report.byTopic.map((group) => [group.name, group.prompts]), [["uncategorized", 1], ["debugging", 1]]);
  assert.deepEqual(report.bySource.map((group) => [group.name, group.prompts]), [["codex", 2]]);
  assert.equal(report.bySource[0].costSharePct, 100);
  assert.equal(report.topPrompts.length, 2);
  assert.equal(report.topPrompts[0].index, 2);
  assert.deepEqual(report.turns[0].tokens, {
    input: 100,
    cached: 25,
    output: 10,
    reasoning: 3
  });
  assert.equal(report.turns[0].cache.grade, "F");
  assert.equal(report.turns[0].context.window, 272000);
  assert.equal(report.turns[0].sourceFormat, "jsonl");
  assert.equal(report.turns[0].promptVisibility, "prompt-and-usage");
  assert.equal(report.turns[0].promptText, "export this prompt");
  assert.equal(report.turns[1].promptVisibility, "usage-only");
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
    assert.match(csv, /^1,2026-05-18T10:00:00.000Z,gpt-5.5,codex,jsonl,prompt-and-usage,building,build an export report,3000,750,120,14,.*goal-1,active,4321,10000$/m);
  } finally {
    console.log = originalLog;
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("export runner defaults to tokenwatch-exports and exports only the most recent session", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const originalCwd = process.cwd();
  const home = await makeTempDir();
  const codexHome = join(home, "codex");
  const claudeHome = join(home, "claude");
  const rolloutPath = join(codexHome, "sessions", "rollout.jsonl");
  const claudePath = join(claudeHome, "session.jsonl");
  const logs = [];
  const originalLog = console.log;

  try {
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    process.chdir(home);
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(claudeHome, { recursive: true });
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: "2026-05-18T09:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "codex session should not be exported"
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 100,
              output_tokens: 50
            }
          }
        }
      })
    ].join("\n"), "utf8");
    await writeFile(claudePath, [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-18T10:00:00.000Z",
        message: { content: "claude previous session export" }
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-18T10:01:00.000Z",
        message: {
          model: "claude-haiku-4-5",
          usage: {
            input_tokens: 500,
            cache_read_input_tokens: 100,
            output_tokens: 25
          }
        }
      })
    ].join("\n"), "utf8");
    createCodexState(join(codexHome, "state_5.sqlite"), rolloutPath);
    await utimes(rolloutPath, new Date("2026-05-18T09:00:00.000Z"), new Date("2026-05-18T09:00:00.000Z"));
    await utimes(claudePath, new Date("2026-05-18T10:00:00.000Z"), new Date("2026-05-18T10:00:00.000Z"));

    console.log = (message) => {
      logs.push(String(message));
    };

    await runExport(["--md"]);

    assert.equal(logs[0], "exported 1 prompts");
    assert.match(logs[1], /^  → tokenwatch-exports\/tokenwatch-\d{4}-\d{2}-\d{2}\.md$/);
    const files = await readdir(join(home, "tokenwatch-exports"));
    assert.equal(files.length, 1);
    const markdown = await readFile(join(home, "tokenwatch-exports", files[0]), "utf8");
    assert.match(markdown, /claude previous session export/);
    assert.doesNotMatch(markdown, /codex session should not be exported/);
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("export runner can target an explicit session and write JSON only", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const home = await makeTempDir();
  const codexHome = join(home, "codex");
  const claudeHome = join(home, "claude");
  const outDir = join(home, "reports");
  const rolloutPath = join(codexHome, "sessions", "rollout.jsonl");
  const claudePath = join(claudeHome, "session.jsonl");
  const logs = [];
  const originalLog = console.log;

  try {
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(claudeHome, { recursive: true });
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: "2026-05-18T09:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "explicit codex export"
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 100,
              output_tokens: 50
            }
          }
        }
      })
    ].join("\n"), "utf8");
    await writeFile(claudePath, [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-18T10:00:00.000Z",
        message: { content: "newer claude export" }
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-18T10:01:00.000Z",
        message: {
          model: "claude-haiku-4-5",
          usage: {
            input_tokens: 500,
            output_tokens: 25
          }
        }
      })
    ].join("\n"), "utf8");
    await utimes(rolloutPath, new Date("2026-05-18T09:00:00.000Z"), new Date("2026-05-18T09:00:00.000Z"));
    await utimes(claudePath, new Date("2026-05-18T10:00:00.000Z"), new Date("2026-05-18T10:00:00.000Z"));

    console.log = (message) => {
      logs.push(String(message));
    };

    await runExport(["--json", "--session", rolloutPath, "--session-source", "codex", "--out", outDir]);

    assert.deepEqual(logs, [
      "exported 1 prompts",
      `  → ${join(outDir, "tokenwatch-2026-05-18.json")}`
    ]);
    const json = JSON.parse(await readFile(join(outDir, "tokenwatch-2026-05-18.json"), "utf8"));
    assert.equal(json.summary.prompts, 1);
    assert.equal(json.turns[0].source, "codex");
    assert.equal(json.turns[0].promptText, "explicit codex export");
    assert.doesNotMatch(JSON.stringify(json), /newer claude export/);
  } finally {
    console.log = originalLog;
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("export runner redacts prompt text while preserving topic and totals", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const home = await makeTempDir();
  const codexHome = join(home, "codex");
  const claudeHome = join(home, "claude");
  const outDir = join(home, "reports");
  const rolloutPath = join(codexHome, "sessions", "rollout.jsonl");
  const sensitivePrompt = "build a Stripe refund dashboard for customer@example.com";
  const logs = [];
  const originalLog = console.log;

  try {
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(claudeHome, { recursive: true });
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: "2026-05-18T09:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: sensitivePrompt
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1200,
              cached_input_tokens: 600,
              output_tokens: 80,
              reasoning_output_tokens: 10
            }
          }
        }
      })
    ].join("\n"), "utf8");

    console.log = (message) => {
      logs.push(String(message));
    };

    await runExport(["--json", "--redact-prompts", "--session", rolloutPath, "--session-source", "codex", "--out", outDir]);

    assert.deepEqual(logs, [
      "exported 1 prompts",
      `  → ${join(outDir, "tokenwatch-2026-05-18.json")}`
    ]);
    const jsonText = await readFile(join(outDir, "tokenwatch-2026-05-18.json"), "utf8");
    const json = JSON.parse(jsonText);
    assert.equal(json.turns[0].promptText, "[redacted]");
    assert.equal(json.turns[0].topic, "building");
    assert.equal(json.summary.totals.inputTokens, 1200);
    assert.doesNotMatch(jsonText, /customer@example\.com/);
    assert.doesNotMatch(jsonText, /Stripe refund dashboard/);
  } finally {
    console.log = originalLog;
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("export runner filters prompts and writes a single report to stdout", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const originalWrite = process.stdout.write;
  const home = await makeTempDir();
  const codexHome = join(home, "codex");
  const claudeHome = join(home, "claude");
  const rolloutPath = join(codexHome, "sessions", "rollout.jsonl");
  let stdout = "";

  try {
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(claudeHome, { recursive: true });
    await writeFile(rolloutPath, [
      codexUserMessage("2026-05-18T08:00:00.000Z", "fix the old bug"),
      codexTokenCount(1000, 100, 50),
      codexUserMessage("2026-05-18T10:00:00.000Z", "build the filtered export"),
      codexTokenCount(2000, 400, 100),
      codexUserMessage("2026-05-18T11:00:00.000Z", "document filtered export"),
      codexTokenCount(3000, 600, 150)
    ].join("\n"), "utf8");

    process.stdout.write = (chunk) => {
      stdout += String(chunk);
      return true;
    };

    await runExport([
      "--json",
      "--stdout",
      "--session",
      rolloutPath,
      "--session-source",
      "codex",
      "--since",
      "2026-05-18T09:00:00.000Z",
      "--until",
      "2026-05-18T10:30:00.000Z",
      "--model",
      "unknown",
      "--topic",
      "building"
    ]);

    const json = JSON.parse(stdout);
    assert.equal(json.summary.prompts, 1);
    assert.equal(json.turns[0].promptText, "build the filtered export");
    assert.equal(json.turns[0].topic, "building");
    assert.doesNotMatch(stdout, /fix the old bug/);
    assert.doesNotMatch(stdout, /document filtered export/);
  } finally {
    process.stdout.write = originalWrite;
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("export runner all-sessions mode combines detected JSONL history", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const home = await makeTempDir();
  const claudeHome = join(home, "claude");
  const codexHome = join(home, "codex");
  const outDir = join(home, "reports");
  const olderPath = join(claudeHome, "projects", "repo", "older.jsonl");
  const newerPath = join(claudeHome, "projects", "repo", "newer.jsonl");
  const logs = [];
  const originalLog = console.log;

  try {
    process.env.HOME = home;
    process.env.CLAUDE_HOME = claudeHome;
    process.env.CODEX_HOME = codexHome;
    await mkdir(join(claudeHome, "projects", "repo"), { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await writeFile(olderPath, claudeTurn("2026-05-17T09:00:00.000Z", "explain older history", 100, 10), "utf8");
    await writeFile(newerPath, claudeTurn("2026-05-18T09:00:00.000Z", "explain newer history", 200, 20), "utf8");
    await utimes(olderPath, new Date("2026-05-17T09:00:00.000Z"), new Date("2026-05-17T09:00:00.000Z"));
    await utimes(newerPath, new Date("2026-05-18T09:00:00.000Z"), new Date("2026-05-18T09:00:00.000Z"));

    console.log = (message) => {
      logs.push(String(message));
    };

    await runExport(["--json", "--all-sessions", "--out", outDir]);

    assert.deepEqual(logs, [
      "exported 2 prompts",
      `  → ${join(outDir, "tokenwatch-2026-05-17.json")}`
    ]);
    const json = JSON.parse(await readFile(join(outDir, "tokenwatch-2026-05-17.json"), "utf8"));
    assert.deepEqual(json.turns.map((turn) => turn.promptText), [
      "explain older history",
      "explain newer history"
    ]);
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
    sourceFormat: overrides.sourceFormat ?? "jsonl",
    promptVisibility: overrides.promptVisibility ?? (overrides.promptText ? "prompt-and-usage" : "usage-only"),
    promptText: overrides.promptText,
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    costUsd,
    cacheGrade: usage.cachedInputTokens / usage.inputTokens >= 0.8 ? "A" : "F",
    cacheHitRate: usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : 0,
    cacheSavingsUsd: usage.cachedInputTokens > 0 && entry
      ? (usage.cachedInputTokens / 1_000_000) * (entry.inputPerMillion - entry.cachedInputPerMillion)
      : 0,
    contextWindow: overrides.contextWindow ?? (overrides.model === "gpt-5.5" ? 272000 : null),
    contextUsagePct: overrides.contextWindow === null ? null : usage.inputTokens / (overrides.contextWindow ?? (overrides.model === "gpt-5.5" ? 272000 : usage.inputTokens)),
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

function codexUserMessage(timestamp, message) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "user_message",
      message
    }
  });
}

function codexTokenCount(inputTokens, cachedInputTokens, outputTokens) {
  return JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: cachedInputTokens,
          output_tokens: outputTokens
        }
      }
    }
  });
}

function claudeTurn(timestamp, promptText, inputTokens, outputTokens) {
  return [
    JSON.stringify({
      type: "user",
      timestamp,
      message: { content: promptText }
    }),
    JSON.stringify({
      type: "assistant",
      timestamp,
      message: {
        model: "claude-haiku-4-5",
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens
        }
      }
    })
  ].join("\n");
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
