import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  getConfigPath,
  getTokenwatchDir,
  loadConfig,
  normalizeConfig,
  saveConfig,
  type TokenwatchConfig
} from "./config.js";
import { collectSessionCandidates, detectSessionSummary } from "./sessions.js";

type InitStatus = "created" | "updated" | "exists";

interface InitArgs {
  dailyBudgetUsd?: number;
  weeklyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  alertAt?: number;
  redactPrompts?: boolean;
  showPrompts?: boolean;
  nonInteractive: boolean;
  help: boolean;
}

export interface InitOptions {
  baseDir?: string;
  dailyBudgetUsd?: number;
  weeklyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  alertAt?: number;
  redactPrompts?: boolean;
  showPrompts?: boolean;
}

export interface InitReport {
  status: InitStatus;
  wrote: boolean;
  path: string;
  config: TokenwatchConfig;
  text: string;
}

export async function runInit(argv: readonly string[] = [], version = "0.0.0"): Promise<void> {
  const args = parseInitArgs(argv);
  if (args.help) {
    printInitHelp();
    return;
  }

  const interactiveOptions = args.nonInteractive ? {} : await promptForInitOptions(args);
  const report = createInitReport({
    dailyBudgetUsd: args.dailyBudgetUsd ?? interactiveOptions.dailyBudgetUsd,
    weeklyBudgetUsd: args.weeklyBudgetUsd ?? interactiveOptions.weeklyBudgetUsd,
    monthlyBudgetUsd: args.monthlyBudgetUsd ?? interactiveOptions.monthlyBudgetUsd,
    alertAt: args.alertAt ?? interactiveOptions.alertAt,
    redactPrompts: args.redactPrompts ?? interactiveOptions.redactPrompts,
    showPrompts: args.showPrompts ?? interactiveOptions.showPrompts
  }, version);
  console.log(report.text.trimEnd());
}

export function createInitReport(options: InitOptions = {}, version = "0.0.0"): InitReport {
  const baseDir = options.baseDir ?? getTokenwatchDir();
  const path = getConfigPath(baseDir);
  const existed = existsSync(path);
  const current = loadConfig(baseDir);
  const config = normalizeConfig({
    ...current,
    dailyBudgetUsd: options.dailyBudgetUsd ?? current.dailyBudgetUsd,
    weeklyBudgetUsd: options.weeklyBudgetUsd ?? current.weeklyBudgetUsd,
    monthlyBudgetUsd: options.monthlyBudgetUsd ?? current.monthlyBudgetUsd,
    alertAt: options.alertAt ?? current.alertAt,
    redactPromptText: options.showPrompts === true
      ? false
      : options.redactPrompts === true
        ? true
        : current.redactPromptText,
    topicRules: current.topicRules
  });
  const changed = !sameConfig(current, config);
  const wrote = !existed || changed;
  if (wrote) {
    saveConfig(config, baseDir);
  }

  const status: InitStatus = !existed ? "created" : changed ? "updated" : "exists";
  return {
    status,
    wrote,
    path,
    config,
    text: renderInitReport(status, wrote, path, config, version)
  };
}

function renderInitReport(
  status: InitStatus,
  wrote: boolean,
  path: string,
  config: TokenwatchConfig,
  version: string
): string {
  const summary = detectSessionSummary();
  const candidates = collectSessionCandidates(summary);
  const active = candidates.filter((candidate) => candidate.active);
  const suggested = active.length > 0 ? active : candidates;
  const lines = [
    "tokenwatch init",
    `Status: ${status}`,
    `Version: tokenwatch ${version}`,
    "",
    "Config:",
    `- Path: ${path}`,
    `- Write: ${wrote ? "saved" : "unchanged"}`,
    `- Daily budget: ${config.dailyBudgetUsd === null ? "none" : `$${config.dailyBudgetUsd}`}`,
    `- Weekly budget: ${config.weeklyBudgetUsd === null ? "none" : `$${config.weeklyBudgetUsd}`}`,
    `- Monthly budget: ${config.monthlyBudgetUsd === null ? "none" : `$${config.monthlyBudgetUsd}`}`,
    `- Alert threshold: ${Math.round(config.alertAt * 100)}%`,
    `- Redaction: ${config.redactPromptText ? "enabled" : "disabled"}`,
    `- Topic rules: ${config.topicRules.length}`,
    "",
    "Detected Sources:",
    `- Claude Code: ${summary.claude.status === "found" ? `found ${summary.claude.format}` : `not detected (${summary.claude.detail})`}`,
    `- Codex CLI: ${summary.codex.status === "found" ? `found ${summary.codex.format}` : `not detected (${summary.codex.detail})`}`,
    "",
    "Next:",
    "- Run tokenwatch doctor to verify prompt visibility and pricing freshness.",
    suggested.length > 0
      ? `- Start watching: tokenwatch --session "${suggested[0]?.path}" --session-source ${suggested[0]?.source}`
      : "- Start Claude Code or Codex CLI, send one prompt, then run tokenwatch doctor again."
  ];

  return `${lines.join("\n")}\n`;
}

async function promptForInitOptions(args: InitArgs): Promise<InitOptions> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return {};
  }

  const rl = createInterface({ input, output });
  try {
    const options: InitOptions = {};
    if (args.redactPrompts === undefined && args.showPrompts === undefined) {
      const answer = await rl.question("Redact prompt text by default? [y/N] ");
      options.redactPrompts = /^y(es)?$/i.test(answer.trim());
    }
    if (args.dailyBudgetUsd === undefined) {
      options.dailyBudgetUsd = parseOptionalPositiveAmount(await rl.question("Daily budget USD (blank for none): "));
    }
    if (args.weeklyBudgetUsd === undefined) {
      options.weeklyBudgetUsd = parseOptionalPositiveAmount(await rl.question("Weekly budget USD (blank for none): "));
    }
    if (args.monthlyBudgetUsd === undefined) {
      options.monthlyBudgetUsd = parseOptionalPositiveAmount(await rl.question("Monthly budget USD (blank for none): "));
    }
    if (args.alertAt === undefined) {
      options.alertAt = parseOptionalAlertAt(await rl.question("Budget alert threshold 0-1 (blank for 0.8): "));
    }
    return options;
  } finally {
    rl.close();
  }
}

function parseInitArgs(argv: readonly string[]): InitArgs {
  const args: InitArgs = { help: false, nonInteractive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--non-interactive") {
      args.nonInteractive = true;
      continue;
    }
    if (arg === "--redact-prompts") {
      args.redactPrompts = true;
      args.showPrompts = false;
      continue;
    }
    if (arg === "--show-prompts") {
      args.showPrompts = true;
      args.redactPrompts = false;
      continue;
    }
    if (arg === "--daily-budget") {
      args.dailyBudgetUsd = parsePositiveAmount(requireValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--weekly-budget") {
      args.weeklyBudgetUsd = parsePositiveAmount(requireValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--monthly-budget") {
      args.monthlyBudgetUsd = parsePositiveAmount(requireValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--alert-at") {
      args.alertAt = parseAlertAt(requireValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown init argument: ${arg}`);
  }
  return args;
}

function sameConfig(a: TokenwatchConfig, b: TokenwatchConfig): boolean {
  return JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b));
}

function parseOptionalPositiveAmount(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : parsePositiveAmount(trimmed, "budget");
}

function parseOptionalAlertAt(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : parseAlertAt(trimmed, "alert threshold");
}

function parsePositiveAmount(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parseAlertAt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`${flag} must be between 0 and 1`);
  }
  return parsed;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printInitHelp(): void {
  console.log(`tokenwatch init

Usage:
  tokenwatch init [--non-interactive] [--redact-prompts|--show-prompts] [--daily-budget <amount>] [--weekly-budget <amount>] [--monthly-budget <amount>] [--alert-at <pct>]
  tokenwatch setup [same options]

Options:
  --non-interactive       Use defaults and explicit flags without terminal prompts
  --redact-prompts        Save config that hides prompt text in tokenwatch by default
  --show-prompts          Save config that shows prompt text in tokenwatch by default
  --daily-budget <amount> Save a daily budget in USD
  --weekly-budget <amount> Save a weekly budget in USD
  --monthly-budget <amount> Save a monthly budget in USD
  --alert-at <pct>        Save budget alert threshold from 0.0 to 1.0
  -h, --help              Show this help.
`);
}
