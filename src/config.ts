import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TokenwatchConfig {
  dailyBudgetUsd: number | null;
  weeklyBudgetUsd: number | null;
  alertAt: number;
}

export const DEFAULT_CONFIG: TokenwatchConfig = {
  dailyBudgetUsd: null,
  weeklyBudgetUsd: null,
  alertAt: 0.8
};

export function getTokenwatchDir(): string {
  return join(homedir(), ".tokenwatch");
}

export function loadConfig(baseDir = getTokenwatchDir()): TokenwatchConfig {
  const path = join(baseDir, "config.json");
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TokenwatchConfig>;
    return {
      dailyBudgetUsd: nullablePositiveNumber(parsed.dailyBudgetUsd),
      weeklyBudgetUsd: nullablePositiveNumber(parsed.weeklyBudgetUsd),
      alertAt: validAlertAt(parsed.alertAt)
    };
  } catch {
    return { ...DEFAULT_CONFIG };
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
