import { createReadStream, existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import chokidar, { type FSWatcher } from "chokidar";
import { parseClaudeLine } from "./parsers/claude.js";
import { parseCodexLogRow } from "./parsers/codex.js";
import type { ActiveSessionFile, CodexLogRow, SessionSource, TokenTurn, WatcherOptions } from "./types.js";

type SqliteDatabase = Database.Database;

export const DEFAULT_WATCHER_OPTIONS: WatcherOptions = {
  claudeGlob: resolve(homedir(), ".claude/projects/**/*.jsonl"),
  codexDbPath: resolve(homedir(), ".codex/logs_2.sqlite"),
  pollIntervalMs: 1000
};

export interface TokenWatcher {
  close(): Promise<void>;
}

interface MaxRowResult {
  maxRowId: number | null;
}

interface CodexPollResult {
  lastRowId: number;
  turns: TokenTurn[];
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
  const claudeWatcher = await startClaudeJsonlWatcher(onTurn, options);
  const codexPoller = startCodexSqlitePoller(onTurn, options);

  return {
    close: async () => {
      await claudeWatcher.close();
      await codexPoller.close();
    }
  };
}

export function getLatestCodexRowId(db: SqliteDatabase): number {
  const row = db
    .prepare<[], MaxRowResult>("SELECT MAX(rowid) AS maxRowId FROM logs")
    .get();
  return row?.maxRowId ?? 0;
}

export function readCodexTurnsSince(
  db: SqliteDatabase,
  lastRowId: number
): CodexPollResult {
  const maxRowId = getLatestCodexRowId(db);
  if (maxRowId <= lastRowId) {
    return { lastRowId, turns: [] };
  }

  const rows = db
    .prepare<[number, number], CodexLogRow>(`
      SELECT rowid AS rowid, feedback_log_body
      FROM logs
      WHERE rowid > ?
        AND rowid <= ?
        AND target = 'log'
        AND feedback_log_body LIKE 'Received message {"type":"response.completed"%'
      ORDER BY rowid ASC
    `)
    .all(lastRowId, maxRowId);

  return {
    lastRowId: maxRowId,
    turns: rows.map(parseCodexLogRow).filter((turn): turn is TokenTurn => turn !== null)
  };
}

async function startClaudeJsonlWatcher(
  onTurn: (turn: TokenTurn) => void,
  options: WatcherOptions
): Promise<TokenWatcher> {
  const files = new Map<string, ActiveSessionFile>();
  const offsets = new Map<string, number>();
  let activePath: string | null = null;

  const watcher = chokidar.watch(options.claudeGlob, {
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

  const updateFile = async (path: string): Promise<void> => {
    const inspected = await inspectPath(path, "claude");
    if (!inspected) {
      files.delete(path);
      offsets.delete(path);
      await refreshActive();
      return;
    }
    files.set(path, inspected);
    await refreshActive();
  };

  const processFile = async (path: string): Promise<void> => {
    await updateFile(path);
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
      const turn = parseClaudeLine(line);
      if (turn) {
        onTurn(turn);
      }
    }
    offsets.set(path, stat.size);
  };

  watcher.on("add", (path) => {
    void processFile(path);
  });
  watcher.on("change", (path) => {
    void processFile(path);
  });
  watcher.on("unlink", (path) => {
    files.delete(path);
    offsets.delete(path);
    void refreshActive();
  });

  return {
    close: async () => {
      await watcher.close();
    }
  };
}

function startCodexSqlitePoller(
  onTurn: (turn: TokenTurn) => void,
  options: WatcherOptions
): TokenWatcher {
  let db: SqliteDatabase | null = null;
  let lastRowId = 0;

  const openDatabase = (): SqliteDatabase | null => {
    if (db?.open) {
      return db;
    }
    if (!existsSync(options.codexDbPath)) {
      return null;
    }

    db = new Database(options.codexDbPath, {
      readonly: true,
      fileMustExist: true
    });
    lastRowId = getLatestCodexRowId(db);
    return db;
  };

  const poll = (): void => {
    const database = openDatabase();
    if (!database) {
      return;
    }

    const result = readCodexTurnsSince(database, lastRowId);
    lastRowId = result.lastRowId;
    for (const turn of result.turns) {
      onTurn(turn);
    }
  };

  const timer = setInterval(poll, options.pollIntervalMs);
  poll();

  return {
    close: async () => {
      clearInterval(timer);
      if (db?.open) {
        db.close();
      }
    }
  };
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
