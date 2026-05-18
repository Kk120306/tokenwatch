#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render, type Instance } from "ink";
import { addSpend, loadSpend, resetSpend, type SpendRecord } from "./budget.js";
import { hasBudget, loadConfig, type TokenwatchConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { runExport } from "./export/runner.js";
import { runInit } from "./init.js";
import { loadPricing, renderPricingInfo } from "./pricing.js";
import { redactParsedTurnPrompt } from "./privacy.js";
import { detectSessionSummary, renderSessionList, resolveSessionSelection } from "./sessions.js";
import { createParsedTurn } from "./turns.js";
import App from "./ui/App.js";
import { DEFAULT_WATCHER_OPTIONS, startTokenWatcher, type TokenWatcher } from "./watcher.js";
import type { ParsedTurn, PricingTable, SessionSource, StorageDetectionSummary, TokenTurn, WatcherOptions } from "./types.js";

interface CliArgs {
  claudeGlob?: string;
  codexDbPath?: string;
  sessionPath?: string;
  sessionSource?: SessionSource;
  topic?: string;
  dailyBudgetUsd?: number;
  weeklyBudgetUsd?: number;
  alertAt?: number;
  redactPrompts: boolean;
  resetBudget: boolean;
  help: boolean;
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === "export") {
    await runExport(argv.slice(1));
    return;
  }
  if (argv[0] === "sessions") {
    console.log(renderSessionList(detectSessionSummary()).trimEnd());
    return;
  }
  if (argv[0] === "pricing") {
    console.log(renderPricingInfo(loadPricing()).trimEnd());
    return;
  }
  if (argv[0] === "doctor") {
    runDoctor(getPackageVersion());
    return;
  }
  if (argv[0] === "init" || argv[0] === "setup") {
    await runInit(argv.slice(1), getPackageVersion());
    return;
  }

  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const pricing = loadPricing();
  const budgetConfig = applyBudgetOverrides(loadConfig(), args);
  let spend = args.resetBudget ? resetSpend() : loadSpend();
  const sessionStart = new Date();
  const version = getPackageVersion();
  const state: RuntimeState = {
    turns: [],
    detectionSummary: null,
    warnings: [],
    lastTurnReceivedAt: null,
    spend
  };
  let turnIndex = 0;
  let watcher: TokenWatcher | null = null;
  let app: Instance | null = null;
  let closing = false;

  const rerender = (): void => {
    app?.rerender(renderApp(state, pricing, budgetConfig, sessionStart, version, close));
  };

  const options: WatcherOptions = {
    ...DEFAULT_WATCHER_OPTIONS,
    claudeGlob: args.claudeGlob,
    codexDbPath: args.codexDbPath,
    logger: (message) => {
      state.warnings = [...state.warnings.slice(-4), message];
      rerender();
    },
    onDetection: (summary) => {
      state.detectionSummary = summary;
      rerender();
    }
  };

  if (args.sessionPath) {
    const selection = resolveSessionSelection(args.sessionPath, args.sessionSource);
    options.claudeGlob = selection.claudeGlob ?? options.claudeGlob;
    options.codexDbPath = selection.codexDbPath ?? options.codexDbPath;
    options.codexSessionPath = selection.codexSessionPath ?? options.codexSessionPath;
  }

  app = render(renderApp(state, pricing, budgetConfig, sessionStart, version, close), {
    exitOnCtrlC: false,
    patchConsole: false
  });

  watcher = await startTokenWatcher((turn: TokenTurn) => {
    const existingIndex = turn.updateKey
      ? state.turns.findIndex((existing) => existing.updateKey === turn.updateKey)
      : -1;
    const id = existingIndex >= 0
      ? state.turns[existingIndex].id
      : ++turnIndex;
    const createdTurn = createParsedTurn(turn, id, pricing, args.topic, budgetConfig.topicRules);
    const parsedTurn = budgetConfig.redactPromptText
      ? redactParsedTurnPrompt(createdTurn)
      : createdTurn;
    if (hasBudget(budgetConfig)) {
      const previousCost = existingIndex >= 0 ? state.turns[existingIndex].costUsd : 0;
      const spendDelta = parsedTurn.costUsd - previousCost;
      if (spendDelta !== 0) {
        spend = addSpend(spendDelta);
        state.spend = spend;
      }
    }
    state.turns = existingIndex >= 0
      ? state.turns.map((existing, index) => index === existingIndex ? parsedTurn : existing)
      : [...state.turns, parsedTurn];
    state.lastTurnReceivedAt = Date.now();
    rerender();
  }, options);

  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });

  async function close(): Promise<void> {
    if (closing) {
      return;
    }
    closing = true;
    await watcher?.close();
    app?.unmount();
    process.exit(0);
  }
}

interface RuntimeState {
  turns: ParsedTurn[];
  detectionSummary: StorageDetectionSummary | null;
  warnings: string[];
  lastTurnReceivedAt: number | null;
  spend: SpendRecord;
}

function renderApp(
  state: RuntimeState,
  pricing: PricingTable,
  budgetConfig: TokenwatchConfig,
  sessionStart: Date,
  version: string,
  onQuit: () => void
): React.ReactElement {
  return React.createElement(App, {
    turns: state.turns,
    pricing,
    budgetConfig,
    spend: state.spend,
    sessionStart,
    detectionSummary: state.detectionSummary,
    version,
    warnings: state.warnings,
    lastTurnReceivedAt: state.lastTurnReceivedAt,
    inputEnabled: process.stdin.isTTY === true && typeof process.stdin.setRawMode === "function",
    onQuit
  });
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, resetBudget: false, redactPrompts: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--claude-glob") {
      args.claudeGlob = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--codex-db") {
      args.codexDbPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--session") {
      args.sessionPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--session-source") {
      args.sessionSource = parseSessionSource(requireValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--topic") {
      args.topic = requireValue(argv, index, arg);
      index += 1;
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
    if (arg === "--alert-at") {
      args.alertAt = parseAlertAt(requireValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--reset-budget") {
      args.resetBudget = true;
      continue;
    }
    if (arg === "--redact-prompts") {
      args.redactPrompts = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function applyBudgetOverrides(config: TokenwatchConfig, args: CliArgs): TokenwatchConfig {
  return {
    dailyBudgetUsd: args.dailyBudgetUsd ?? config.dailyBudgetUsd,
    weeklyBudgetUsd: args.weeklyBudgetUsd ?? config.weeklyBudgetUsd,
    alertAt: args.alertAt ?? config.alertAt,
    topicRules: config.topicRules,
    redactPromptText: args.redactPrompts || config.redactPromptText
  };
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

function parseSessionSource(value: string, flag: string): SessionSource {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new Error(`${flag} must be "claude" or "codex"`);
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function getPackageVersion(): string {
  const packagePath = relativeToProjectRoot("package.json");
  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function relativeToProjectRoot(path: string): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return relative(process.cwd(), `${currentDir}/../${path}`);
}

function printHelp(): void {
  console.log(`tokenwatch

Usage:
  tokenwatch export [--md] [--csv] [--json] [--redact-prompts] [--session <path>] [--session-source <claude|codex>] [--out <dir>]
  tokenwatch init [--redact-prompts] [--daily-budget <amount>] [--weekly-budget <amount>]
  tokenwatch sessions
  tokenwatch doctor
  tokenwatch pricing
  tokenwatch [--session <path>] [--session-source <claude|codex>] [--claude-glob <glob>] [--codex-db <path>] [--topic <name>] [--redact-prompts] [--daily-budget <amount>] [--weekly-budget <amount>]

Options:
  export               Write Markdown, CSV, and/or JSON reports without launching the TUI
  init, setup          Create or update ~/.tokenwatch/config.json for first-run defaults
  sessions             List detected local Claude Code and Codex CLI sessions
  doctor               Validate local log discovery, config, pricing freshness, and suggested commands
  pricing              Show bundled pricing freshness, sources, and model rates
  --md                 With export, include the Markdown report
  --csv                With export, include the CSV report
  --json               With export, write a structured JSON report
  --out <dir>          With export, write reports to this directory. Default: ./tokenwatch-exports
  --session <path>      Watch or export a specific JSONL, log, or SQLite session path
  --session-source <source> Source for ambiguous --session JSONL paths: claude or codex
  --claude-glob <glob>  Claude Code JSONL glob. Default: auto-detect from $CLAUDE_HOME or ~/.claude
  --codex-db <path>     Codex CLI SQLite database. Default: auto-detect from $CODEX_HOME or ~/.codex
  --topic <name>        Manually tag every parsed prompt in this session with the given topic
  --redact-prompts      Replace captured prompt text with [redacted] in the TUI and exports
  --daily-budget <amount>   Daily budget in USD. Overrides ~/.tokenwatch/config.json
  --weekly-budget <amount>  Weekly budget in USD. Overrides ~/.tokenwatch/config.json
  --alert-at <pct>          Alert threshold from 0.0 to 1.0. Default: 0.8
  --reset-budget            Reset persisted daily and weekly spend totals, then start watching
  -h, --help            Show this help.

Environment:
  CODEX_HOME            Codex home directory to check before ~/.codex
  CLAUDE_HOME           Claude Code home directory to check before ~/.claude
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`tokenwatch: ${message}`);
  process.exit(1);
});
