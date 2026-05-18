#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render, type Instance } from "ink";
import { runExport } from "./export/runner.js";
import { loadPricing } from "./pricing.js";
import { createParsedTurn } from "./turns.js";
import App from "./ui/App.js";
import { DEFAULT_WATCHER_OPTIONS, startTokenWatcher, type TokenWatcher } from "./watcher.js";
import type { ParsedTurn, PricingTable, StorageDetectionSummary, TokenTurn, WatcherOptions } from "./types.js";

interface CliArgs {
  claudeGlob?: string;
  codexDbPath?: string;
  topic?: string;
  help: boolean;
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === "export") {
    await runExport(argv.slice(1));
    return;
  }

  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const pricing = loadPricing();
  const version = getPackageVersion();
  const state: RuntimeState = {
    turns: [],
    detectionSummary: null,
    warnings: [],
    lastTurnReceivedAt: null
  };
  let turnIndex = 0;
  let watcher: TokenWatcher | null = null;
  let app: Instance | null = null;
  let closing = false;

  const rerender = (): void => {
    app?.rerender(renderApp(state, pricing, version, close));
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

  app = render(renderApp(state, pricing, version, close), {
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
    const parsedTurn = createParsedTurn(turn, id, pricing, args.topic);
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
}

function renderApp(
  state: RuntimeState,
  pricing: PricingTable,
  version: string,
  onQuit: () => void
): React.ReactElement {
  return React.createElement(App, {
    turns: state.turns,
    pricing,
    detectionSummary: state.detectionSummary,
    version,
    warnings: state.warnings,
    lastTurnReceivedAt: state.lastTurnReceivedAt,
    inputEnabled: process.stdin.isTTY === true && typeof process.stdin.setRawMode === "function",
    onQuit
  });
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false };
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
    if (arg === "--topic") {
      args.topic = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
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
  tokenwatch export [--md] [--csv] [--out <dir>]
  tokenwatch [--claude-glob <glob>] [--codex-db <path>] [--topic <name>]

Options:
  export               Write Markdown and/or CSV reports for the current session without launching the TUI
  --md                 With export, write only the Markdown report unless --csv is also present
  --csv                With export, write only the CSV report unless --md is also present
  --out <dir>          With export, write reports to this directory. Default: current directory
  --claude-glob <glob>  Claude Code JSONL glob. Default: auto-detect from $CLAUDE_HOME or ~/.claude
  --codex-db <path>     Codex CLI SQLite database. Default: auto-detect from $CODEX_HOME or ~/.codex
  --topic <name>        Manually tag every parsed prompt in this session with the given topic
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
