import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTokenwatchDir } from "./config.js";

export interface SpendRecord {
  dailyTotal: number;
  dailyDate: string;
  weeklyTotal: number;
  weeklyStartDate: string;
}

export function loadSpend(baseDir = getTokenwatchDir(), now = new Date()): SpendRecord {
  const path = join(baseDir, "spend.json");
  const fallback = emptySpend(now);
  if (!existsSync(path)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SpendRecord>;
    return normalizeSpend({
      dailyTotal: positiveNumber(parsed.dailyTotal),
      dailyDate: typeof parsed.dailyDate === "string" ? parsed.dailyDate : fallback.dailyDate,
      weeklyTotal: positiveNumber(parsed.weeklyTotal),
      weeklyStartDate: typeof parsed.weeklyStartDate === "string" ? parsed.weeklyStartDate : fallback.weeklyStartDate
    }, now);
  } catch {
    return fallback;
  }
}

export function saveSpend(record: SpendRecord, baseDir = getTokenwatchDir()): void {
  mkdirSync(baseDir, { recursive: true });
  const path = join(baseDir, "spend.json");
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

export function addSpend(costUsd: number, baseDir = getTokenwatchDir(), now = new Date()): SpendRecord {
  const current = loadSpend(baseDir, now);
  const next = {
    ...current,
    dailyTotal: Math.max(0, current.dailyTotal + costUsd),
    weeklyTotal: Math.max(0, current.weeklyTotal + costUsd)
  };
  saveSpend(next, baseDir);
  return next;
}

export function resetSpend(baseDir = getTokenwatchDir(), now = new Date()): SpendRecord {
  const record = emptySpend(now);
  saveSpend(record, baseDir);
  return record;
}

export function getProjectedDailySpend(dailyTotal: number, sessionStart: Date, now = new Date()): number {
  const elapsedHours = Math.max((now.getTime() - sessionStart.getTime()) / 3_600_000, 1 / 60);
  return (dailyTotal / elapsedHours) * 24;
}

export function getProjectedWeeklySpend(weeklyTotal: number, sessionStart: Date, now = new Date()): number {
  const elapsedHours = Math.max((now.getTime() - sessionStart.getTime()) / 3_600_000, 1 / 60);
  return (weeklyTotal / elapsedHours) * 24 * 7;
}

export function getDailyResetDate(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

export function getWeeklyResetDate(now = new Date()): Date {
  const currentDay = now.getDay();
  const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday);
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getWeekStartDateKey(date: Date): string {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = start.getDay();
  const daysSinceMonday = currentDay === 0 ? 6 : currentDay - 1;
  start.setDate(start.getDate() - daysSinceMonday);
  return formatDateKey(start);
}

function emptySpend(now: Date): SpendRecord {
  return {
    dailyTotal: 0,
    dailyDate: formatDateKey(now),
    weeklyTotal: 0,
    weeklyStartDate: getWeekStartDateKey(now)
  };
}

function normalizeSpend(record: SpendRecord, now: Date): SpendRecord {
  const today = formatDateKey(now);
  const weekStart = getWeekStartDateKey(now);
  return {
    dailyTotal: record.dailyDate === today ? record.dailyTotal : 0,
    dailyDate: today,
    weeklyTotal: record.weeklyStartDate === weekStart ? record.weeklyTotal : 0,
    weeklyStartDate: weekStart
  };
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
