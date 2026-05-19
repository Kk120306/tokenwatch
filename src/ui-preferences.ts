import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTokenwatchDir } from "./config.js";

export type ActiveView = "prompts" | "models" | "stats";
export type PromptSortMode = "time" | "cacheGrade" | "contextUsage";
export type StatsFocus = "top" | "recommendations";

export interface UiPreferences {
  activeView: ActiveView;
  uncheckedModels: string[];
  uncheckedTopics: string[];
  showTokens: boolean;
  promptSortMode: PromptSortMode;
  statsFocus: StatsFocus;
}

interface PersistedUiPreferences extends Partial<UiPreferences> {
  schemaVersion?: number;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  activeView: "prompts",
  uncheckedModels: [],
  uncheckedTopics: [],
  showTokens: false,
  promptSortMode: "time",
  statsFocus: "top"
};

export function getUiPreferencesPath(baseDir = getTokenwatchDir()): string {
  return join(baseDir, "ui-state.json");
}

export function loadUiPreferences(baseDir = getTokenwatchDir()): UiPreferences {
  const path = getUiPreferencesPath(baseDir);
  if (!existsSync(path)) {
    return createDefaultUiPreferences();
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedUiPreferences;
    return normalizeUiPreferences(parsed);
  } catch {
    return createDefaultUiPreferences();
  }
}

export function saveUiPreferences(
  preferences: Partial<UiPreferences>,
  baseDir = getTokenwatchDir()
): string {
  mkdirSync(baseDir, { recursive: true });
  const path = getUiPreferencesPath(baseDir);
  const tmpPath = `${path}.tmp`;
  const normalized = normalizeUiPreferences(preferences);
  writeFileSync(tmpPath, `${JSON.stringify({ schemaVersion: 1, ...normalized }, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
  return path;
}

export function normalizeUiPreferences(preferences: Partial<UiPreferences> = {}): UiPreferences {
  return {
    activeView: validActiveView(preferences.activeView),
    uncheckedModels: validStringList(preferences.uncheckedModels),
    uncheckedTopics: validStringList(preferences.uncheckedTopics),
    showTokens: preferences.showTokens === true,
    promptSortMode: validPromptSortMode(preferences.promptSortMode),
    statsFocus: validStatsFocus(preferences.statsFocus)
  };
}

function createDefaultUiPreferences(): UiPreferences {
  return {
    ...DEFAULT_UI_PREFERENCES,
    uncheckedModels: [],
    uncheckedTopics: []
  };
}

function validActiveView(value: unknown): ActiveView {
  return value === "models" || value === "stats" || value === "prompts"
    ? value
    : DEFAULT_UI_PREFERENCES.activeView;
}

function validPromptSortMode(value: unknown): PromptSortMode {
  return value === "cacheGrade" || value === "contextUsage" || value === "time"
    ? value
    : DEFAULT_UI_PREFERENCES.promptSortMode;
}

function validStatsFocus(value: unknown): StatsFocus {
  return value === "recommendations" || value === "top"
    ? value
    : DEFAULT_UI_PREFERENCES.statsFocus;
}

function validStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  )];
}
