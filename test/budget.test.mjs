import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addSpend,
  getProjectedDailySpend,
  getProjectedWeeklySpend,
  loadSpend,
  resetSpend
} from "../dist/budget.js";
import { loadConfig } from "../dist/config.js";

test("budget config loads defaults and validates configured values", async () => {
  const dir = join(tmpdir(), `tokenwatch-config-${Date.now()}`);
  try {
    assert.deepEqual(loadConfig(dir), {
      dailyBudgetUsd: null,
      weeklyBudgetUsd: null,
      alertAt: 0.8
    });

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), JSON.stringify({
      dailyBudgetUsd: 5,
      weeklyBudgetUsd: 25,
      alertAt: 0.75
    }), "utf8");

    assert.deepEqual(loadConfig(dir), {
      dailyBudgetUsd: 5,
      weeklyBudgetUsd: 25,
      alertAt: 0.75
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("spend records persist and reset on daily and weekly boundaries", async () => {
  const dir = join(tmpdir(), `tokenwatch-spend-${Date.now()}`);
  const monday = new Date("2026-05-18T10:00:00");
  const tuesday = new Date("2026-05-19T10:00:00");
  const nextMonday = new Date("2026-05-25T10:00:00");

  try {
    let spend = resetSpend(dir, monday);
    assert.deepEqual(spend, {
      dailyTotal: 0,
      dailyDate: "2026-05-18",
      weeklyTotal: 0,
      weeklyStartDate: "2026-05-18"
    });

    spend = addSpend(1.25, dir, monday);
    assert.equal(spend.dailyTotal, 1.25);
    assert.equal(spend.weeklyTotal, 1.25);

    spend = loadSpend(dir, tuesday);
    assert.equal(spend.dailyTotal, 0);
    assert.equal(spend.dailyDate, "2026-05-19");
    assert.equal(spend.weeklyTotal, 1.25);
    assert.equal(spend.weeklyStartDate, "2026-05-18");

    spend = loadSpend(dir, nextMonday);
    assert.equal(spend.dailyTotal, 0);
    assert.equal(spend.weeklyTotal, 0);
    assert.equal(spend.weeklyStartDate, "2026-05-25");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget projections extrapolate current spend rate", () => {
  const start = new Date("2026-05-18T00:00:00");
  const now = new Date("2026-05-18T06:00:00");

  assert.equal(getProjectedDailySpend(6, start, now), 24);
  assert.equal(getProjectedWeeklySpend(6, start, now), 168);
});
