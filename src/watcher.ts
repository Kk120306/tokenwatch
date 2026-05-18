import { createReadStream, existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import chokidar, { type FSWatcher } from "chokidar";
import { parseClaudeLine } from "./parsers/claude.js";
import { CodexDeltaParser } from "./parsers/codex.js";
import type { ActiveSessionFile, SessionSource, TokenTurn, WatcherOptions } from "./types.js";

export const DEFAULT_WATCHER_OPTIONS: WatcherOptions = {
  claudeGlob: resolve(homedir(), ".claude/projects/**/*.jsonl"),
  codexGlob: resolve(homedir(), ".codex/*.jsonl"),
  pollIntervalMs: 250
};

export interface TokenWatcher {
  close(): Promise<void>;
}

export async function findMostRecentSessionFile(
  candidates: readonly ActiveSessionFile[]
): Promise<ActiveSessionFile | null> {
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
}

export async function inspectPath(
  path: string,
  source: SessionSource
): Promise<ActiveSessionFile | null> {
  if (!existsSync(path)) {
    return null;
  }
  const stat = await fs.stat(path);
  if (!stat.isFile()) {
    return null;
  }
  return {
    source,
    path,
    mtimeMs: stat.mtimeMs
  };
}

export async function startTokenWatcher(
  onTurn: (turn: TokenTurn) => void,
  options: WatcherOptions = DEFAULT_WATCHER_OPTIONS
): Promise<TokenWatcher> {
  const files = new Map<string, ActiveSessionFile>();
  const offsets = new Map<string, number>();
  const codexParsers = new Map<string, CodexDeltaParser>();
  let activePath: string | null = null;

  const watcher = chokidar.watch([options.claudeGlob, options.codexGlob], {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: options.pollIntervalMs,
      pollInterval: options.pollIntervalMs
    }
  });

  const refreshActive = async (): Promise<void> => {
    const active = await findMostRecentSessionFile([...files.values()]);
    activePath = active?.path ?? null;
  };

  const updateFile = async (path: string, source: SessionSource): Promise<void> => {
    const inspected = await inspectPath(path, source);
    if (!inspected) {
      files.delete(path);
      offsets.delete(path);
      codexParsers.delete(path);
      await refreshActive();
      return;
    }
    files.set(path, inspected);
    await refreshActive();
  };

  const processFile = async (path: string, source: SessionSource): Promise<void> => {
    await updateFile(path, source);
    if (activePath !== path) {
      return;
    }

    const stat = await fs.stat(path);
    const previousOffset = offsets.get(path) ?? 0;
    if (stat.size < previousOffset) {
      offsets.set(path, 0);
    }
    const start = offsets.get(path) ?? 0;
    if (stat.size === start) {
      return;
    }

    for await (const line of readNewLines(path, start, stat.size)) {
      const turn =
        source === "claude"
          ? parseClaudeLine(line)
          : getCodexParser(codexParsers, path).parseLine(line);
      if (turn) {
        onTurn(turn);
      }
    }
    offsets.set(path, stat.size);
  };

  watcher.on("add", (path) => {
    void processFile(path, sourceForPath(path, options));
  });
  watcher.on("change", (path) => {
    void processFile(path, sourceForPath(path, options));
  });
  watcher.on("unlink", (path) => {
    files.delete(path);
    offsets.delete(path);
    codexParsers.delete(path);
    void refreshActive();
  });

  return {
    close: async () => {
      await watcher.close();
    }
  };
}

function sourceForPath(path: string, options: WatcherOptions): SessionSource {
  const codexRoot = options.codexGlob.replace(/\*.*$/, "");
  return path.startsWith(codexRoot) ? "codex" : "claude";
}

function getCodexParser(
  parsers: Map<string, CodexDeltaParser>,
  path: string
): CodexDeltaParser {
  const existing = parsers.get(path);
  if (existing) {
    return existing;
  }
  const parser = new CodexDeltaParser();
  parsers.set(path, parser);
  return parser;
}

async function* readNewLines(
  path: string,
  start: number,
  end: number
): AsyncGenerator<string> {
  const stream = createReadStream(path, {
    encoding: "utf8",
    start,
    end: end - 1
  });
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    yield line;
  }
}
