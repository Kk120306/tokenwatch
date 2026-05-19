import { createReadStream, existsSync, promises as fs } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import { loadConfig } from "../config.js";
import { detectClaudeStorage, detectCodexStorage } from "../detect.js";
import { loadPricing } from "../pricing.js";
import { redactParsedTurnPrompt } from "../privacy.js";
import { createClaudeParser } from "../parsers/claude.js";
import { createCodexJsonlParser, createCodexSqliteParser } from "../parsers/codex.js";
import { createParsedTurn } from "../turns.js";
import { resolveSessionSelection } from "../sessions.js";
import { findMostRecentSessionFile, inspectPath, readCodexTurnsSince } from "../watcher.js";
import { renderCsvReport } from "./csv.js";
import { formatFilenameDate } from "./format.js";
import { renderJsonReport } from "./json.js";
import { renderMarkdownReport } from "./markdown.js";
import type { ActiveSessionFile, FoundStorageResult, ParsedTurn, PricingTable, SessionSource, StorageResult, TokenTurn, TopicRuleConfig } from "../types.js";

const DEFAULT_EXPORT_DIR = "tokenwatch-exports";

interface ExportArgs {
  markdown: boolean;
  csv: boolean;
  json: boolean;
  outDir: string;
  sessionPath?: string;
  sessionSource?: SessionSource;
  redactPrompts: boolean;
  stdout: boolean;
  allSessions: boolean;
  since?: Date;
  until?: Date;
  models: string[];
  topics: string[];
}

interface ExportSession {
  storage: FoundStorageResult;
  activeFile: ActiveSessionFile;
}

export async function runExport(argv: readonly string[]): Promise<void> {
  const args = parseExportArgs(argv);
  const pricing = loadPricing();
  const config = loadConfig();
  const turns = await readCurrentSessionTurns(
    pricing,
    args,
    config.topicRules,
    args.redactPrompts || config.redactPromptText
  );
  if (turns.length === 0) {
    console.log("no matching prompts found — adjust export filters or start a prompt first");
    return;
  }

  if (args.stdout) {
    process.stdout.write(renderStdoutReport(turns, pricing, args));
    return;
  }

  await mkdir(args.outDir, { recursive: true });
  const filenameDate = formatFilenameDate(turns[0]?.timestamp ?? new Date());
  const writtenFiles: string[] = [];

  if (args.markdown) {
    const path = await nextAvailablePath(args.outDir, filenameDate, "md");
    await fs.writeFile(path, renderMarkdownReport(turns, pricing), "utf8");
    writtenFiles.push(path);
  }

  if (args.csv) {
    const path = await nextAvailablePath(args.outDir, filenameDate, "csv");
    await fs.writeFile(path, renderCsvReport(turns, pricing), "utf8");
    writtenFiles.push(path);
  }

  if (args.json) {
    const path = await nextAvailablePath(args.outDir, filenameDate, "json");
    await fs.writeFile(path, renderJsonReport(turns, pricing), "utf8");
    writtenFiles.push(path);
  }

  console.log(`exported ${turns.length} prompts`);
  for (const path of writtenFiles) {
    console.log(`  → ${displayPath(path)}`);
  }
}

function parseExportArgs(argv: readonly string[]): ExportArgs {
  let markdown = false;
  let csv = false;
  let json = false;
  let outDir = DEFAULT_EXPORT_DIR;
  let sessionPath: string | undefined;
  let sessionSource: SessionSource | undefined;
  let redactPrompts = false;
  let stdout = false;
  let allSessions = false;
  let since: Date | undefined;
  let until: Date | undefined;
  const models: string[] = [];
  const topics: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--md") {
      markdown = true;
      continue;
    }
    if (arg === "--csv") {
      csv = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--redact-prompts") {
      redactPrompts = true;
      continue;
    }
    if (arg === "--stdout") {
      stdout = true;
      continue;
    }
    if (arg === "--all-sessions") {
      allSessions = true;
      continue;
    }
    if (arg === "--since") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --since");
      }
      since = parseDateBound(value, "--since", "start");
      index += 1;
      continue;
    }
    if (arg === "--until") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --until");
      }
      until = parseDateBound(value, "--until", "end");
      index += 1;
      continue;
    }
    if (arg === "--model") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --model");
      }
      models.push(...parseFilterValues(value));
      index += 1;
      continue;
    }
    if (arg === "--topic") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --topic");
      }
      topics.push(...parseFilterValues(value));
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      outDir = value;
      index += 1;
      continue;
    }
    if (arg === "--session") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --session");
      }
      sessionPath = value;
      index += 1;
      continue;
    }
    if (arg === "--session-source") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --session-source");
      }
      sessionSource = parseSessionSource(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown export argument: ${arg}`);
  }

  if (!markdown && !csv && !json) {
    if (stdout) {
      markdown = true;
    } else {
      markdown = true;
      csv = true;
    }
  }

  if (stdout && [markdown, csv, json].filter(Boolean).length !== 1) {
    throw new Error("--stdout requires exactly one report format (--md, --csv, or --json)");
  }

  return {
    markdown,
    csv,
    json,
    outDir: resolve(outDir),
    sessionPath,
    sessionSource,
    redactPrompts,
    stdout,
    allSessions,
    since,
    until,
    models,
    topics
  };
}

function parseSessionSource(value: string): SessionSource {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new Error("--session-source must be \"claude\" or \"codex\"");
}

async function readCurrentSessionTurns(
  pricing: PricingTable,
  options: Pick<ExportArgs, "sessionPath" | "sessionSource" | "allSessions" | "since" | "until" | "models" | "topics"> = {
    allSessions: false,
    models: [],
    topics: []
  },
  topicRules: readonly TopicRuleConfig[] = [],
  redactPrompts = false
): Promise<ParsedTurn[]> {
  const detected = detectExportStorage(options);
  const sessions = await findExportSessions(detected, options.allSessions && !options.sessionPath);
  if (sessions.length === 0) {
    return [];
  }
  const turns = (await Promise.all(
    sessions.map((session) => readStorageTurns(session.storage, session.activeFile.path))
  )).flat();

  const parsed: ParsedTurn[] = [];
  const byUpdateKey = new Map<string, number>();
  let nextId = 0;

  for (const turn of turns.sort(compareTurns)) {
    if (isZeroTokenTurn(turn)) {
      continue;
    }
    const existingIndex = turn.updateKey ? byUpdateKey.get(turn.updateKey) : undefined;
    if (existingIndex !== undefined) {
      parsed[existingIndex] = applyPrivacy(
        createParsedTurn(turn, parsed[existingIndex].id, pricing, undefined, topicRules),
        redactPrompts
      );
      continue;
    }
    const parsedTurn = applyPrivacy(
      createParsedTurn(turn, ++nextId, pricing, undefined, topicRules),
      redactPrompts
    );
    if (turn.updateKey) {
      byUpdateKey.set(turn.updateKey, parsed.length);
    }
    parsed.push(parsedTurn);
  }

  return applyExportFilters(
    parsed.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    options
  );
}

function applyPrivacy(turn: ParsedTurn, redactPrompts: boolean): ParsedTurn {
  return redactPrompts ? redactParsedTurnPrompt(turn) : turn;
}

function detectExportStorage(options: Pick<ExportArgs, "sessionPath" | "sessionSource">): StorageResult[] {
  if (!options.sessionPath) {
    return [
      detectClaudeStorage(),
      detectCodexStorage()
    ];
  }

  const selection = resolveSessionSelection(options.sessionPath, options.sessionSource);
  if (selection.source === "claude") {
    return [detectClaudeStorage({ claudeGlob: selection.claudeGlob })];
  }
  return [detectCodexStorage({
    codexDbPath: selection.codexDbPath,
    codexSessionPath: selection.codexSessionPath
  })];
}

async function findExportSessions(
  detected: readonly StorageResult[],
  includeAllSessions: boolean
): Promise<ExportSession[]> {
  const sessions = (await Promise.all(
    detected.map((storage) => findExportSessionsForStorage(storage, includeAllSessions))
  )).flat();
  const sorted = sessions.sort((a, b) => b.activeFile.mtimeMs - a.activeFile.mtimeMs);
  return includeAllSessions ? sorted : sorted.slice(0, 1);
}

async function findExportSessionsForStorage(
  storage: StorageResult,
  includeAllSessions: boolean
): Promise<ExportSession[]> {
  if (storage.status !== "found") {
    return [];
  }
  if (storage.format === "sqlite") {
    const activeFile = await inspectPath(storage.path, storage.source);
    return activeFile ? [{ storage, activeFile }] : [];
  }
  if (!includeAllSessions) {
    const activeFile = await findActiveStoragePath(storage);
    return activeFile ? [{ storage, activeFile }] : [];
  }
  const inspected = await Promise.all(storage.paths.map((path) => inspectPath(path, storage.source)));
  return inspected
    .filter((activeFile): activeFile is ActiveSessionFile => activeFile !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((activeFile) => ({ storage, activeFile }));
}

async function readStorageTurns(storage: FoundStorageResult, activePath: string): Promise<TokenTurn[]> {
  let turns: TokenTurn[];
  if (storage.source === "codex" && storage.format === "sqlite") {
    turns = readCodexSqliteTurns(activePath);
    return turns.map((turn) => ({ ...turn, sourceFormat: storage.format, goal: storage.goal ?? null }));
  }
  const parser = storage.source === "claude"
    ? createClaudeParser().parseLine
    : createCodexJsonlParser({ model: storage.model }).parseLine;
  turns = await readParsedLines(activePath, parser);
  return storage.source === "codex"
    ? turns.map((turn) => ({ ...turn, sourceFormat: storage.format, goal: storage.goal ?? null }))
    : turns.map((turn) => ({ ...turn, sourceFormat: storage.format }));
}

async function findActiveStoragePath(storage: FoundStorageResult): Promise<ActiveSessionFile | null> {
  const inspected = await Promise.all(storage.paths.map((path) => inspectPath(path, storage.source)));
  return findMostRecentSessionFile(inspected.filter((file) => file !== null));
}

function readCodexSqliteTurns(path: string): TokenTurn[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const parser = createCodexSqliteParser();
    return readCodexTurnsSince(db, 0, parser.parseRow).turns;
  } finally {
    if (db?.open) {
      db.close();
    }
  }
}

async function readParsedLines(
  path: string,
  parseLine: (line: string) => TokenTurn | null
): Promise<TokenTurn[]> {
  const turns: TokenTurn[] = [];
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    const turn = parseLine(line);
    if (turn) {
      turns.push(turn);
    }
  }
  return turns;
}

async function nextAvailablePath(outDir: string, date: string, extension: "md" | "csv" | "json"): Promise<string> {
  for (let counter = 1; ; counter += 1) {
    const suffix = counter === 1 ? "" : `-${counter}`;
    const path = join(outDir, `tokenwatch-${date}${suffix}.${extension}`);
    if (!existsSync(path)) {
      return path;
    }
  }
}

function compareTurns(a: TokenTurn, b: TokenTurn): number {
  return a.timestamp.getTime() - b.timestamp.getTime();
}

function isZeroTokenTurn(turn: TokenTurn): boolean {
  return turn.usage.inputTokens === 0 &&
    turn.usage.cachedInputTokens === 0 &&
    turn.usage.outputTokens === 0 &&
    turn.usage.reasoningTokens === 0;
}

function renderStdoutReport(
  turns: readonly ParsedTurn[],
  pricing: PricingTable,
  args: Pick<ExportArgs, "markdown" | "csv" | "json">
): string {
  if (args.json) {
    return renderJsonReport(turns, pricing);
  }
  if (args.csv) {
    return renderCsvReport(turns, pricing);
  }
  return renderMarkdownReport(turns, pricing);
}

function applyExportFilters(
  turns: readonly ParsedTurn[],
  options: Pick<ExportArgs, "since" | "until" | "models" | "topics">
): ParsedTurn[] {
  const modelSet = new Set(options.models.map((model) => model.trim()).filter(Boolean));
  const topicSet = new Set(options.topics.map(normalizeTopicFilter).filter(Boolean));
  return turns.filter((turn) => {
    if (options.since && turn.timestamp < options.since) {
      return false;
    }
    if (options.until && turn.timestamp > options.until) {
      return false;
    }
    if (modelSet.size > 0 && !modelSet.has(turn.model)) {
      return false;
    }
    if (topicSet.size > 0 && !topicSet.has(normalizeTopicFilter(turn.topic ?? "untagged"))) {
      return false;
    }
    return true;
  });
}

function parseFilterValues(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseDateBound(value: string, flag: string, mode: "start" | "end"): Date {
  const trimmed = value.trim();
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const normalized = isoDateOnly
    ? `${trimmed}T${mode === "start" ? "00:00:00.000" : "23:59:59.999"}Z`
    : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} must be an ISO date or timestamp`);
  }
  return parsed;
}

function normalizeTopicFilter(topic: string): string {
  const normalized = topic.trim().toLowerCase();
  return normalized === "uncategorized" ? "untagged" : normalized;
}

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  if (!relativePath || relativePath.startsWith("..")) {
    return path;
  }
  return relativePath;
}
