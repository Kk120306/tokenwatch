import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFile = promisify(execFileCallback);
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..");
const cliPath = join(repoRoot, "dist", "index.js");


test("CLI e2e exposes help and machine-readable pricing", async () => {
  const home = await makeIsolatedHome();
  try {
    const help = await runTokenwatch(["--help"], home);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /tokenwatch export/);
    assert.match(help.stdout, /tokenwatch pricing \[--json\]/);
    assert.equal(help.stderr, "");

    const pricing = await runTokenwatch(["pricing", "--json"], home);
    assert.equal(pricing.code, 0);
    assert.equal(pricing.stderr, "");
    const report = JSON.parse(pricing.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.ok(report.models.some((entry) => entry.model === "gpt-5.5"));
  } finally {
    await rm(home.root, { recursive: true, force: true });
  }
});

test("CLI e2e writes init JSON without interactive prompts", async () => {
  const home = await makeIsolatedHome();
  try {
    const result = await runTokenwatch([
      "init",
      "--json",
      "--daily-budget",
      "5",
      "--alert-at",
      "0.7",
      "--redact-prompts"
    ], home);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status, "created");
    assert.equal(report.config.dailyBudgetUsd, 5);
    assert.equal(report.config.alertAt, 0.7);
    assert.equal(report.config.redactPromptText, true);
  } finally {
    await rm(home.root, { recursive: true, force: true });
  }
});

test("CLI e2e exports a Codex rollout session to stdout JSON", async () => {
  const home = await makeIsolatedHome();
  const rolloutPath = join(home.codexHome, "sessions", "rollout.jsonl");
  try {
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, [
      codexUserMessage("2026-05-18T10:00:00.000Z", "build the e2e export report"),
      codexTokenCount(1200, 200, 150)
    ].join("\n"), "utf8");

    const result = await runTokenwatch([
      "export",
      "--json",
      "--stdout",
      "--session",
      rolloutPath,
      "--session-source",
      "codex"
    ], home);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.summary.prompts, 1);
    assert.equal(report.turns[0].source, "codex");
    assert.equal(report.turns[0].promptText, "build the e2e export report");
  } finally {
    await rm(home.root, { recursive: true, force: true });
  }
});

test("CLI e2e reports invalid arguments with non-zero exit", async () => {
  const home = await makeIsolatedHome();
  try {
    const badPricing = await runTokenwatch(["pricing", "--bogus"], home);
    assert.equal(badPricing.code, 1);
    assert.equal(badPricing.stdout, "");
    assert.match(badPricing.stderr, /tokenwatch: Unknown pricing argument: --bogus/);

    const badExport = await runTokenwatch(["export", "--json", "--csv", "--stdout"], home);
    assert.equal(badExport.code, 1);
    assert.equal(badExport.stdout, "");
    assert.match(badExport.stderr, /--stdout requires exactly one report format/);
  } finally {
    await rm(home.root, { recursive: true, force: true });
  }
});

async function runTokenwatch(args, home) {
  const env = {
    ...process.env,
    HOME: home.root,
    CODEX_HOME: home.codexHome,
    CLAUDE_HOME: home.claudeHome,
    FORCE_COLOR: "0",
    NO_COLOR: "1"
  };
  try {
    const { stdout, stderr } = await execFile(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env,
      maxBuffer: 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      return {
        code: Number(error.code),
        stdout: String(error.stdout ?? ""),
        stderr: String(error.stderr ?? "")
      };
    }
    throw error;
  }
}

async function makeIsolatedHome() {
  const root = await mkdtemp(join(tmpdir(), "tokenwatch-cli-"));
  const codexHome = join(root, "codex");
  const claudeHome = join(root, "claude");
  await mkdir(codexHome, { recursive: true });
  await mkdir(claudeHome, { recursive: true });
  return { root, codexHome, claudeHome };
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
