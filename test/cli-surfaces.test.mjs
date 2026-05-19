import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInit } from "../dist/init.js";


test("init JSON surface writes config and keeps stdout parseable", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "tokenwatch-init-"));
  const originalWrite = process.stdout.write;
  let stdout = "";

  try {
    process.stdout.write = (chunk) => {
      stdout += String(chunk);
      return true;
    };

    await runInit([
      "--json",
      "--daily-budget",
      "7",
      "--alert-at",
      "0.75",
      "--redact-prompts"
    ], "0.1.0", { baseDir });

    const report = JSON.parse(stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status, "created");
    assert.equal(report.wrote, true);
    assert.equal(report.version, "0.1.0");
    assert.equal(report.path, join(baseDir, "config.json"));
    assert.equal(report.config.dailyBudgetUsd, 7);
    assert.equal(report.config.alertAt, 0.75);
    assert.equal(report.config.redactPromptText, true);
    assert.doesNotMatch(stdout, /tokenwatch init\nStatus:/);
  } finally {
    process.stdout.write = originalWrite;
    await rm(baseDir, { recursive: true, force: true });
  }
});
