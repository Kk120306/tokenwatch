import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TopicRuleConfig } from "./types.js";

export interface TokenwatchConfig {
  dailyBudgetUsd: number | null;
  weeklyBudgetUsd: number | null;
  alertAt: number;
  topicRules: TopicRuleConfig[];
  redactPromptText: boolean;
}

export const DEFAULT_CONFIG: TokenwatchConfig = {
  dailyBudgetUsd: null,
  weeklyBudgetUsd: null,
  alertAt: 0.8,
  topicRules: [],
  redactPromptText: false
};

export function getTokenwatchDir(): string {
  return join(homedir(), ".tokenwatch");
}

export function loadConfig(baseDir = getTokenwatchDir()): TokenwatchConfig {
  const path = join(baseDir, "config.json");
  if (!existsSync(path)) {
    return createDefaultConfig();
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TokenwatchConfig>;
    return {
      dailyBudgetUsd: nullablePositiveNumber(parsed.dailyBudgetUsd),
      weeklyBudgetUsd: nullablePositiveNumber(parsed.weeklyBudgetUsd),
      alertAt: validAlertAt(parsed.alertAt),
      topicRules: validTopicRules(parsed.topicRules),
      redactPromptText: parsed.redactPromptText === true
    };
  } catch {
    return createDefaultConfig();
  }
}

export function hasBudget(config: TokenwatchConfig): boolean {
  return config.dailyBudgetUsd !== null || config.weeklyBudgetUsd !== null;
}

function nullablePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function validAlertAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : DEFAULT_CONFIG.alertAt;
}

function validTopicRules(value: unknown): TopicRuleConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules: TopicRuleConfig[] = [];
  for (const rule of value) {
    if (!rule || typeof rule !== "object") {
      continue;
    }
    const topic = "topic" in rule && typeof rule.topic === "string" ? rule.topic.trim() : "";
    const rawKeywords: unknown[] = "keywords" in rule && Array.isArray(rule.keywords)
      ? rule.keywords
      : [];
    const keywords = rawKeywords
        .filter((keyword): keyword is string => typeof keyword === "string")
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);
    if (topic && keywords.length > 0) {
      rules.push({ topic, keywords });
    }
  }
  return rules;
}

function createDefaultConfig(): TokenwatchConfig {
  return {
    ...DEFAULT_CONFIG,
    topicRules: [...DEFAULT_CONFIG.topicRules]
  };
}
