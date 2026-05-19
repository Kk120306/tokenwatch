import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { detectClaudeStorage, detectCodexStorage } from "../dist/detect.js";

async function makeTempDir() {
  const dir = join(tmpdir(), `tokenwatch-detect-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function createValidCodexSqlite(path) {
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

function createValidCodexState(path, rolloutPath, model = "gpt-5.5") {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE threads (
      rollout_path TEXT,
      model TEXT,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO threads (rollout_path, model, updated_at_ms) VALUES (?, ?, ?)").run(rolloutPath, model, Date.now());
  db.close();
}

test("Codex detector prefers state_5 rollout path over logs fallback", async () => {
  const home = await makeTempDir();
  try {
    const rolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-test.jsonl");
    await mkdir(join(home, "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(rolloutPath, "{}\n", "utf8");
    createValidCodexState(join(home, "state_5.sqlite"), rolloutPath);
    createValidCodexSqlite(join(home, "logs_2.sqlite"));

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.format, "jsonl");
    assert.equal(result.path, rolloutPath);
    assert.equal(result.model, "gpt-5.5");
    assert.match(result.detail, /state_5\.sqlite/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector chooses the most recently updated thread from state_5", async () => {
  const home = await makeTempDir();
  try {
    const oldRolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-old.jsonl");
    const newRolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-new.jsonl");
    await mkdir(join(home, "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(oldRolloutPath, "{}\n", "utf8");
    await writeFile(newRolloutPath, "{}\n", "utf8");

    const db = new Database(join(home, "state_5.sqlite"));
    db.exec(`
      CREATE TABLE threads (
        rollout_path TEXT,
        model TEXT,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    db.prepare("INSERT INTO threads (rollout_path, model, updated_at_ms) VALUES (?, ?, ?)").run(oldRolloutPath, "gpt-5", now - 1000);
    db.prepare("INSERT INTO threads (rollout_path, model, updated_at_ms) VALUES (?, ?, ?)").run(newRolloutPath, "gpt-5.5", now);
    db.close();

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.path, newRolloutPath);
    assert.equal(result.model, "gpt-5.5");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector skips unreadable active threads and selects an older readable rollout", async () => {
  const home = await makeTempDir();
  try {
    const readableRolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-readable.jsonl");
    const missingRolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-missing.jsonl");
    await mkdir(join(home, "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(readableRolloutPath, "{}\n", "utf8");

    const db = new Database(join(home, "state_5.sqlite"));
    db.exec(`
      CREATE TABLE threads (
        rollout_path TEXT,
        model TEXT,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    db.prepare("INSERT INTO threads (rollout_path, model, updated_at_ms) VALUES (?, ?, ?)").run(readableRolloutPath, "gpt-5", now - 1000);
    db.prepare("INSERT INTO threads (rollout_path, model, updated_at_ms) VALUES (?, ?, ?)").run(missingRolloutPath, "gpt-5.5", now);
    db.close();

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.path, readableRolloutPath);
    assert.equal(result.model, "gpt-5");
    assert.match(result.warnings.join("\n"), /skipped 1 unreadable Codex rollout thread/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector does not let stale state block SQLite fallback", async () => {
  const home = await makeTempDir();
  try {
    const rolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-stale.jsonl");
    await mkdir(join(home, "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(rolloutPath, "{}\n", "utf8");
    createValidCodexSqlite(join(home, "logs_2.sqlite"));

    const db = new Database(join(home, "state_5.sqlite"));
    db.exec(`
      CREATE TABLE threads (
        rollout_path TEXT,
        model TEXT,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT INTO threads (rollout_path, model, updated_at_ms) VALUES (?, ?, ?)")
      .run(rolloutPath, "gpt-5.5", Date.now() - 600_000);
    db.close();

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.format, "sqlite");
    assert.equal(result.path, join(home, "logs_2.sqlite"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector attaches active goal metadata from thread_goals", async () => {
  const home = await makeTempDir();
  try {
    const rolloutPath = join(home, "sessions", "2026", "05", "18", "rollout-goal.jsonl");
    await mkdir(join(home, "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(rolloutPath, "{}\n", "utf8");

    const db = new Database(join(home, "state_5.sqlite"));
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
    `).run("thread-1", "goal-1", "ship goal-mode token detection", "active", 200000, 12345, 67, now);
    db.close();

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.threadId, "thread-1");
    assert.deepEqual(result.goal, {
      goalId: "goal-1",
      objective: "ship goal-mode token detection",
      status: "active",
      tokenBudget: 200000,
      tokensUsed: 12345,
      timeUsedSeconds: 67
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector prefers readable valid SQLite", async () => {
  const home = await makeTempDir();
  try {
    await mkdir(join(home, "sessions", "2026"), { recursive: true });
    await writeFile(join(home, "sessions", "2026", "session.jsonl"), "{}\n", "utf8");
    createValidCodexSqlite(join(home, "logs_2.sqlite"));

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.format, "sqlite");
    assert.equal(result.path, join(home, "logs_2.sqlite"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector accepts an explicit rollout session path", async () => {
  const home = await makeTempDir();
  try {
    const rolloutPath = join(home, ".codex", "sessions", "2026", "05", "18", "rollout-test.jsonl");
    await mkdir(join(home, ".codex", "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(rolloutPath, "{}\n", "utf8");

    const result = detectCodexStorage({
      codexSessionPath: rolloutPath,
      codexHome: join(home, "missing"),
      defaultCodexHome: join(home, "missing-default")
    });

    assert.equal(result.status, "found");
    assert.equal(result.format, "jsonl");
    assert.equal(result.path, rolloutPath);
    assert.deepEqual(result.paths, [rolloutPath]);
    assert.equal(result.detail, "--session");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector falls back to session JSONL when SQLite schema is unexpected", async () => {
  const home = await makeTempDir();
  try {
    const db = new Database(join(home, "logs_2.sqlite"));
    db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, body TEXT);");
    db.close();
    await mkdir(join(home, "sessions", "2026", "05"), { recursive: true });
    await writeFile(join(home, "sessions", "2026", "05", "session.jsonl"), "{}\n", "utf8");

    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.format, "jsonl");
    assert.equal(result.path, join(home, "sessions"));
    assert.match(result.warnings.join("\n"), /schema is missing expected/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex detector reports actionable missing result", async () => {
  const home = await makeTempDir();
  try {
    const result = detectCodexStorage({ codexHome: home, defaultCodexHome: join(home, "missing") });

    assert.deepEqual({ status: result.status, format: result.format, path: result.path }, {
      status: "missing",
      format: "none",
      path: null
    });
    assert.match(result.detail, /CODEX_HOME/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Claude detector finds project JSONL before direct home JSONL", async () => {
  const home = await makeTempDir();
  try {
    await mkdir(join(home, "projects", "repo"), { recursive: true });
    await writeFile(join(home, "history.jsonl"), "{}\n", "utf8");
    await writeFile(join(home, "projects", "repo", "session.jsonl"), "{}\n", "utf8");

    const result = detectClaudeStorage({ claudeHome: home, defaultClaudeHome: join(home, "missing") });

    assert.equal(result.status, "found");
    assert.equal(result.format, "jsonl");
    assert.equal(result.path, join(home, "projects"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("watcher re-runs detection and reports a new Codex JSONL source", async () => {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalClaudeHome = process.env.CLAUDE_HOME;
  const home = await makeTempDir();
  const codexHome = join(home, "codex");
  const claudeHome = join(home, "claude");
  const summaries = [];
  let watcher;

  try {
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    const { startTokenWatcher } = await import("../dist/watcher.js");
    watcher = await startTokenWatcher(() => {}, {
      pollIntervalMs: 10,
      detectionIntervalMs: 50,
      logger: () => {},
      onDetection: (summary) => summaries.push(summary)
    });

    await mkdir(join(codexHome, "sessions", "2026", "05", "18"), { recursive: true });
    await writeFile(join(codexHome, "sessions", "2026", "05", "18", "session.jsonl"), "\n", "utf8");

    await waitFor(() => summaries.some((summary) => summary.codex.status === "found" && summary.codex.format === "jsonl"));
    assert.equal(summaries.at(-1).codex.format, "jsonl");
  } finally {
    await watcher?.close();
    restoreEnv("HOME", originalHome);
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CLAUDE_HOME", originalClaudeHome);
    await rm(home, { recursive: true, force: true });
  }
});

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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
