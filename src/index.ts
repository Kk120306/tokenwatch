#!/usr/bin/env node
import { basename } from "node:path";
import { formatSeparator, formatSessionTotal, formatTurn, addToTotal, createEmptyTotal } from "./display.js";
import { estimateCostUsd, loadPricing } from "./pricing.js";
import { DEFAULT_WATCHER_OPTIONS, startTokenWatcher } from "./watcher.js";
import type { SessionTotal, TurnSummary, TokenTurn, WatcherOptions } from "./types.js";

interface CliArgs {
  claudeGlob?: string;
  codexDbPath?: string;
  help: boolean;
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const pricing = loadPricing();
  let turnIndex = 0;
  let total: SessionTotal = createEmptyTotal();
  const options: WatcherOptions = {
    ...DEFAULT_WATCHER_OPTIONS,
    claudeGlob: args.claudeGlob ?? DEFAULT_WATCHER_OPTIONS.claudeGlob,
    codexDbPath: args.codexDbPath ?? DEFAULT_WATCHER_OPTIONS.codexDbPath
  };

  console.log(`tokenwatch watching ${basename(options.claudeGlob)} and ${options.codexDbPath}`);

  const watcher = await startTokenWatcher((turn: TokenTurn) => {
    const summary: TurnSummary = {
      ...turn,
      index: ++turnIndex,
      costUsd: estimateCostUsd(turn.model, turn.usage, pricing)
    };
    total = addToTotal(total, summary);
    console.log(formatTurn(summary));
    console.log(formatSeparator());
    console.log(formatSessionTotal(total));
  }, options);

  const close = async (): Promise<void> => {
    await watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
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

function printHelp(): void {
  console.log(`tokenwatch

Usage:
  tokenwatch [--claude-glob <glob>] [--codex-db <path>]

Options:
  --claude-glob <glob>  Claude Code JSONL glob. Default: ~/.claude/projects/**/*.jsonl
  --codex-db <path>     Codex CLI SQLite database. Default: ~/.codex/logs_2.sqlite
  -h, --help            Show this help.
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`tokenwatch: ${message}`);
  process.exit(1);
});
