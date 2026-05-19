import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_UI_PREFERENCES, getUiPreferencesPath, loadUiPreferences, normalizeUiPreferences, saveUiPreferences } from "../dist/ui-preferences.js";


test("UI preferences load defaults, normalize invalid fields, and round-trip", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "tokenwatch-ui-prefs-"));
  try {
    assert.deepEqual(loadUiPreferences(baseDir), DEFAULT_UI_PREFERENCES);

    const path = saveUiPreferences({
      activeView: "models",
      uncheckedModels: ["gpt-5.5", "", "gpt-5.5", "claude-sonnet-4-6"],
      uncheckedTopics: ["debugging"],
      showTokens: true,
      promptSortMode: "cacheGrade",
      statsFocus: "recommendations"
    }, baseDir);

    assert.equal(path, getUiPreferencesPath(baseDir));
    assert.deepEqual(loadUiPreferences(baseDir), {
      activeView: "models",
      uncheckedModels: ["gpt-5.5", "claude-sonnet-4-6"],
      uncheckedTopics: ["debugging"],
      showTokens: true,
      promptSortMode: "cacheGrade",
      statsFocus: "recommendations"
    });

    await writeFile(path, JSON.stringify({
      activeView: "bad",
      uncheckedModels: [" gpt-5.5 ", 7, ""],
      uncheckedTopics: "not-array",
      showTokens: "yes",
      promptSortMode: "bad",
      statsFocus: "bad"
    }), "utf8");
    assert.deepEqual(loadUiPreferences(baseDir), {
      activeView: "prompts",
      uncheckedModels: ["gpt-5.5"],
      uncheckedTopics: [],
      showTokens: false,
      promptSortMode: "time",
      statsFocus: "top"
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("UI preference normalization rejects unsafe shapes", () => {
  assert.deepEqual(normalizeUiPreferences({
    activeView: "stats",
    uncheckedModels: ["gpt-5", "gpt-5", "claude"],
    uncheckedTopics: [" building "],
    showTokens: true,
    promptSortMode: "contextUsage",
    statsFocus: "top"
  }), {
    activeView: "stats",
    uncheckedModels: ["gpt-5", "claude"],
    uncheckedTopics: ["building"],
    showTokens: true,
    promptSortMode: "contextUsage",
    statsFocus: "top"
  });
});
