import { createReadStream, existsSync, promises as fs, statSync } from "node:fs";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import chokidar, { type FSWatcher } from "chokidar";
import { detectClaudeStorage, detectCodexStorage } from "./detect.js";
import { createClaudeParser } from "./parsers/claude.js";
import { createCodexJsonlParser, createCodexSqliteParser, parseCodexLogRow } from "./parsers/codex.js";
import type {
  ActiveSessionFile,
  CodexLogRow,
  CodexStorageResult,
  FoundStorageResult,
  GoalMetadata,
  SessionSource,
  StorageDetectionSummary,
  StorageResult,
  TokenTurn,
  WatcherOptions
} from "./types.js";

type SqliteDatabase = Database.Database;
type LineParser = (line: string) => TokenTurn | null;
type LineParserFactory = () => LineParser;
type CodexSqliteRowParser = (row: CodexLogRow) => TokenTurn | null;
type JsonlInitialReadMode = "tail" | "all";

const DUPLICATE_TURN_WINDOW_MS = 5000;

export const DEFAULT_WATCHER_OPTIONS: WatcherOptions = {
  pollIntervalMs: 1000,
  detectionIntervalMs: 30_000
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
  const resolvedOptions: WatcherOptions = {
    ...DEFAULT_WATCHER_OPTIONS,
    ...options
  };
  const logger = resolvedOptions.logger ?? ((message: string): void => console.warn(message));

  let closed = false;
  let claudeWatcher: TokenWatcher | null = null;
  let codexWatcher: TokenWatcher | null = null;
  let claudeSignature = "";
  let codexSignature = "";
  let activeCodexSource: "rollout-jsonl" | "sqlite" | "none" = "none";
  let codexStartupAnnouncementDone = false;
  let codexModel: string | undefined;
  let codexGoal: GoalMetadata | null = null;
  let codexWaitingForSession = false;
  let detectionTimer: NodeJS.Timeout | null = null;
  const seenTurnKeys = new Set<string>();

  const emitTurn = (turn: TokenTurn): void => {
    if (isDuplicateTurn(turn, seenTurnKeys)) {
      return;
    }
    onTurn(turn);
  };

  const applyDetection = async (forceNotify: boolean): Promise<void> => {
    if (closed) {
      return;
    }

    const summary: StorageDetectionSummary = {
      claude: detectClaudeStorage({ claudeGlob: resolvedOptions.claudeGlob }),
      codex: detectCodexStorage({
        codexDbPath: resolvedOptions.codexDbPath,
        codexSessionPath: resolvedOptions.codexSessionPath
      })
    };

    if (summary.codex.status === "found") {
      codexModel = summary.codex.model;
      codexGoal = summary.codex.goal ?? null;
    } else {
      codexGoal = null;
    }
    codexWaitingForSession = summary.codex.status === "missing" && summary.codex.detail.includes("waiting for session");

    const nextClaudeSignature = storageSignature(summary.claude);
    const nextCodexSignature = storageSignature(summary.codex);
    const changed = nextClaudeSignature !== claudeSignature || nextCodexSignature !== codexSignature;

    if (forceNotify || changed) {
      for (const warning of [...summary.claude.warnings, ...summary.codex.warnings]) {
        logger(`tokenwatch: ${warning}`);
      }
    }

    if (nextClaudeSignature !== claudeSignature) {
      await claudeWatcher?.close();
      claudeWatcher = await startWatcherForDetectedStorage(
        summary.claude,
        () => createClaudeParser().parseLine,
        resolvedOptions,
        logger,
        "tail"
      );
      claudeSignature = nextClaudeSignature;
    }

    if (nextCodexSignature !== codexSignature) {
      const candidateSource = codexSourceFrom(summary.codex);

      if (activeCodexSource !== "none" && candidateSource !== "none" && candidateSource !== activeCodexSource) {
        // Lock to the first Codex source that wins to avoid duplicate turns from re-detection flips.
      } else {
        if (!codexStartupAnnouncementDone || (activeCodexSource === "none" && candidateSource !== "none")) {
          activeCodexSource = candidateSource;
          codexStartupAnnouncementDone = true;
          if (activeCodexSource === "rollout-jsonl") {
            logger("tokenwatch: codex \u2192 rollout jsonl \u2713");
          } else if (activeCodexSource === "sqlite") {
            logger("tokenwatch: codex \u2192 sqlite \u2713");
          } else {
            logger("tokenwatch: codex \u2192 waiting for session...");
          }
        }

        // Ignore model-only changes to avoid restarting the JSONL reader from byte zero.
        const shouldRestart = shouldRestartCodexWatcher(summary.codex, codexSignature);
        if (shouldRestart) {
          await codexWatcher?.close();
          codexWatcher = await startCodexWatcher(
            summary.codex,
            emitTurn,
            resolvedOptions,
            logger,
            codexSignature === "" ? "tail" : "all",
            () => codexModel,
            () => codexGoal
          );
        }
        codexSignature = nextCodexSignature;
        if (activeCodexSource === "none") {
          activeCodexSource = candidateSource;
        }
      }
    }

    if (forceNotify || changed) {
      resolvedOptions.onDetection?.(summary);
    }
  };

  const scheduleDetection = (delayMs: number): void => {
    if (detectionTimer) {
      clearTimeout(detectionTimer);
    }
    detectionTimer = setTimeout(() => {
      void runDetectionLoop();
    }, delayMs);
  };

  const runDetectionLoop = async (): Promise<void> => {
    await applyDetection(false);
    const nextDelay = shouldPollCodexFast()
      ? 2000
      : resolvedOptions.detectionIntervalMs;
    scheduleDetection(nextDelay);
  };

  const shouldPollCodexFast = (): boolean => {
    return codexWaitingForSession;
  };

  await applyDetection(true);
  scheduleDetection(shouldPollCodexFast() ? 2000 : resolvedOptions.detectionIntervalMs);

  return {
    close: async () => {
      closed = true;
      if (detectionTimer) {
        clearTimeout(detectionTimer);
      }
      await claudeWatcher?.close();
      await codexWatcher?.close();
    }
  };

  async function startWatcherForDetectedStorage(
    result: StorageResult,
    parserFactory: LineParserFactory,
    watcherOptions: WatcherOptions,
    watcherLogger: (message: string) => void,
    initialReadMode: JsonlInitialReadMode
  ): Promise<TokenWatcher | null> {
    if (result.status !== "found") {
      return null;
    }
    return startJsonlWatcher(emitTurn, result, parserFactory, watcherOptions, watcherLogger, initialReadMode);
  }
}

function codexSourceFrom(result: CodexStorageResult): "rollout-jsonl" | "sqlite" | "none" {
  if (result.status !== "found") {
    return "none";
  }
  return result.format === "sqlite" ? "sqlite" : "rollout-jsonl";
}

function shouldRestartCodexWatcher(result: CodexStorageResult, previousSignature: string): boolean {
  if (previousSignature === "") {
    return true;
  }
  if (result.status !== "found") {
    return true;
  }
  const parts = previousSignature.split(":");
  const prevSource = parts[0];
  const prevFormat = parts[1];
  const prevPath = parts[2];
  if (prevSource !== "codex") {
    return true;
  }
  if (prevFormat !== result.format) {
    return true;
  }
  if (prevPath !== result.path) {
    return true;
  }
  return false;
}

export function getLatestCodexRowId(db: SqliteDatabase): number {
  const row = db
    .prepare<[], MaxRowResult>("SELECT MAX(id) AS maxRowId FROM logs")
    .get();
  return row?.maxRowId ?? 0;
}

export function readCodexTurnsSince(
  db: SqliteDatabase,
  lastRowId: number,
  parseRow: CodexSqliteRowParser = parseCodexLogRow
): CodexPollResult {
  const maxRowId = getLatestCodexRowId(db);
  if (maxRowId <= lastRowId) {
    return { lastRowId, turns: [] };
  }

  const rows = db
    .prepare<[number, number], CodexLogRow>(`
      SELECT id AS rowid, feedback_log_body
      FROM logs
      WHERE id > ?
        AND id <= ?
        AND target = 'log'
        AND feedback_log_body LIKE 'Received message %'
      ORDER BY id ASC
    `)
    .all(lastRowId, maxRowId);

  return {
    lastRowId: maxRowId,
    turns: rows.map(parseRow).filter((turn): turn is TokenTurn => turn !== null)
  };
}

async function startCodexWatcher(
  result: CodexStorageResult,
  onTurn: (turn: TokenTurn) => void,
  options: WatcherOptions,
  logger: (message: string) => void,
  initialReadMode: JsonlInitialReadMode,
  getModel: () => string | undefined,
  getGoal: () => GoalMetadata | null
): Promise<TokenWatcher | null> {
  if (result.status !== "found") {
    return null;
  }

  const onCodexTurn = (turn: TokenTurn): void => {
    onTurn(withGoal(turn, getGoal()));
  };

  if (result.format === "sqlite") {
    return startCodexSqlitePoller(onCodexTurn, result.path, options, logger);
  }

  return startJsonlWatcher(
    onCodexTurn,
    result,
    () => createCodexJsonlParser({ getModel }).parseLine,
    options,
    logger,
    initialReadMode
  );
}

async function startJsonlWatcher(
  onTurn: (turn: TokenTurn) => void,
  storage: FoundStorageResult,
  parserFactory: LineParserFactory,
  options: WatcherOptions,
  logger: (message: string) => void,
  initialReadMode: JsonlInitialReadMode
): Promise<TokenWatcher> {
  const files = new Map<string, ActiveSessionFile>();
  const offsets = new Map<string, number>();
  const parsers = new Map<string, LineParser>();
  let activePath: string | null = null;
  let initialScanReady = false;
  const watchTarget = storage.pattern ?? storage.paths;

  if (initialReadMode === "tail") {
    for (const path of storage.paths) {
      try {
        offsets.set(path, statSync(path).size);
      } catch (error) {
        logger(`tokenwatch: skipped initial offset for ${storage.source} file ${path}: ${errorMessage(error)}`);
      }
    }
  }

  const watcher: FSWatcher = chokidar.watch(watchTarget, {
    ignoreInitial: false,
    usePolling: true,
    interval: Math.min(options.pollIntervalMs, 250)
  });

  const refreshActive = async (): Promise<void> => {
    const active = await findMostRecentSessionFile([...files.values()]);
    activePath = active?.path ?? null;
  };

  const updateFile = async (path: string): Promise<void> => {
    try {
      const inspected = await inspectPath(path, storage.source);
      if (!inspected) {
        files.delete(path);
        offsets.delete(path);
        parsers.delete(path);
        await refreshActive();
        return;
      }
      files.set(path, inspected);
      await refreshActive();
    } catch (error) {
      files.delete(path);
      offsets.delete(path);
      parsers.delete(path);
      logger(`tokenwatch: skipped unreadable ${storage.source} file ${path}: ${errorMessage(error)}`);
      await refreshActive();
    }
  };

  const processFile = async (path: string): Promise<void> => {
    await updateFile(path);
    if (activePath !== path) {
      return;
    }

    let stat;
    try {
      stat = await fs.stat(path);
    } catch (error) {
      logger(`tokenwatch: skipped missing ${storage.source} file ${path}: ${errorMessage(error)}`);
      return;
    }

    const previousOffset = offsets.get(path);
    if (previousOffset === undefined && initialReadMode === "tail" && !initialScanReady) {
      offsets.set(path, stat.size);
      parsers.delete(path);
      return;
    }

    if (previousOffset !== undefined && stat.size < previousOffset) {
      offsets.set(path, stat.size);
      parsers.delete(path);
      return;
    }

    const start = offsets.get(path) ?? 0;
    if (stat.size === start) {
      return;
    }

    try {
      const parser = parsers.get(path) ?? parserFactory();
      parsers.set(path, parser);
      for await (const line of readNewLines(path, start, stat.size)) {
        const turn = parser(line);
        if (turn) {
          onTurn(turn);
        }
      }
      offsets.set(path, stat.size);
    } catch (error) {
      logger(`tokenwatch: failed reading ${storage.source} file ${path}: ${errorMessage(error)}`);
    }
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
    parsers.delete(path);
    void refreshActive();
  });
  watcher.on("error", (error) => {
    logger(`tokenwatch: watcher error for ${storage.source} ${storage.detail}: ${errorMessage(error)}`);
  });
  watcher.on("ready", () => {
    initialScanReady = true;
  });

  return {
    close: async () => {
      await watcher.close();
    }
  };
}

function startCodexSqlitePoller(
  onTurn: (turn: TokenTurn) => void,
  codexDbPath: string,
  options: WatcherOptions,
  logger: (message: string) => void
): TokenWatcher {
  let db: SqliteDatabase | null = null;
  let lastRowId = 0;
  let warned = false;
  const parser = createCodexSqliteParser();

  const closeDatabase = (): void => {
    if (db?.open) {
      db.close();
    }
    db = null;
  };

  const openDatabase = (): SqliteDatabase | null => {
    if (db?.open) {
      return db;
    }
    if (!existsSync(codexDbPath)) {
      return null;
    }

    try {
      db = new Database(codexDbPath, {
        readonly: true,
        fileMustExist: true
      });
      lastRowId = getLatestCodexRowId(db);
      warned = false;
      return db;
    } catch (error) {
      if (!warned) {
        logger(`tokenwatch: Codex SQLite unavailable at ${codexDbPath}; will keep detecting fallbacks (${errorMessage(error)})`);
        warned = true;
      }
      closeDatabase();
      return null;
    }
  };

  const poll = (): void => {
    const database = openDatabase();
    if (!database) {
      return;
    }

    try {
      const result = readCodexTurnsSince(database, lastRowId, parser.parseRow);
      lastRowId = result.lastRowId;
      for (const turn of result.turns) {
        onTurn(turn);
      }
    } catch (error) {
      logger(`tokenwatch: Codex SQLite read failed at ${codexDbPath}; falling back on next detection (${errorMessage(error)})`);
      closeDatabase();
    }
  };

  const timer = setInterval(poll, options.pollIntervalMs);
  poll();

  return {
    close: async () => {
      clearInterval(timer);
      closeDatabase();
    }
  };
}

function storageSignature(result: StorageResult): string {
  if (result.status === "missing") {
    return `${result.source}:missing:${result.detail}:${result.warnings.join("|")}`;
  }
  return `${result.source}:${result.format}:${result.path}:${result.paths.join("|")}:${result.model ?? ""}:${result.goal?.goalId ?? ""}:${result.goal?.status ?? ""}:${result.goal?.tokensUsed ?? ""}`;
}

function withGoal(turn: TokenTurn, goal: GoalMetadata | null): TokenTurn {
  return goal ? { ...turn, goal } : { ...turn, goal: null };
}

function isDuplicateTurn(turn: TokenTurn, seenTurnKeys: Set<string>): boolean {
  const turnKey = [
    turn.model,
    turn.usage.inputTokens,
    turn.usage.outputTokens,
    turn.usage.cachedInputTokens,
    Math.floor(turn.timestamp.getTime() / DUPLICATE_TURN_WINDOW_MS)
  ].join(":");

  if (seenTurnKeys.has(turnKey)) {
    return true;
  }

  seenTurnKeys.add(turnKey);
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
