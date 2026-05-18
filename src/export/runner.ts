import { createReadStream, existsSync, promises as fs } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import { detectClaudeStorage, detectCodexStorage } from "../detect.js";
import { loadPricing } from "../pricing.js";
import { createClaudeParser } from "../parsers/claude.js";
import { createCodexJsonlParser } from "../parsers/codex.js";
import { createParsedTurn } from "../turns.js";
import { findMostRecentSessionFile, inspectPath, readCodexTurnsSince } from "../watcher.js";
import { renderCsvReport } from "./csv.js";
import { formatFilenameDate } from "./format.js";
import { renderMarkdownReport } from "./markdown.js";
import type { ActiveSessionFile, FoundStorageResult, ParsedTurn, PricingTable, StorageResult, TokenTurn } from "../types.js";

const DEFAULT_EXPORT_DIR = "tokenwatch-exports";

interface ExportArgs {
  markdown: boolean;
  csv: boolean;
  outDir: string;
}

interface ExportSession {
  storage: FoundStorageResult;
  activeFile: ActiveSessionFile;
}

export async function runExport(argv: readonly string[]): Promise<void> {
  const args = parseExportArgs(argv);
  const pricing = loadPricing();
  const turns = await readCurrentSessionTurns(pricing);
  if (turns.length === 0) {
    console.log("no active session found — start a prompt first");
    return;
  }

  await mkdir(args.outDir, { recursive: true });
  const filenameDate = formatFilenameDate(new Date());
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

  console.log(`exported ${turns.length} prompts`);
  for (const path of writtenFiles) {
    console.log(`  → ${displayPath(path)}`);
  }
}

function parseExportArgs(argv: readonly string[]): ExportArgs {
  let markdown = false;
  let csv = false;
  let outDir = DEFAULT_EXPORT_DIR;

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
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      outDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown export argument: ${arg}`);
  }

  if (!markdown && !csv) {
    markdown = true;
    csv = true;
  }

  return {
    markdown,
    csv,
    outDir: resolve(outDir)
  };
}

async function readCurrentSessionTurns(pricing: PricingTable): Promise<ParsedTurn[]> {
  const detected: StorageResult[] = [
    detectClaudeStorage(),
    detectCodexStorage()
  ];
  const session = await findPreviousSession(detected);
  if (!session) {
    return [];
  }
  const turns = await readStorageTurns(session.storage, session.activeFile.path);

  const parsed: ParsedTurn[] = [];
  const byUpdateKey = new Map<string, number>();
  let nextId = 0;

  for (const turn of turns.sort(compareTurns)) {
    if (isZeroTokenTurn(turn)) {
      continue;
    }
    const existingIndex = turn.updateKey ? byUpdateKey.get(turn.updateKey) : undefined;
    if (existingIndex !== undefined) {
      parsed[existingIndex] = createParsedTurn(turn, parsed[existingIndex].id, pricing);
      continue;
    }
    const parsedTurn = createParsedTurn(turn, ++nextId, pricing);
    if (turn.updateKey) {
      byUpdateKey.set(turn.updateKey, parsed.length);
    }
    parsed.push(parsedTurn);
  }

  return parsed.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

async function findPreviousSession(detected: readonly StorageResult[]): Promise<ExportSession | null> {
  const sessions = await Promise.all(detected.map(findExportSession));
  return sessions
    .filter((session): session is ExportSession => session !== null)
    .sort((a, b) => b.activeFile.mtimeMs - a.activeFile.mtimeMs)[0] ?? null;
}

async function findExportSession(storage: StorageResult): Promise<ExportSession | null> {
  if (storage.status !== "found") {
    return null;
  }
  const activeFile = storage.format === "sqlite"
    ? await inspectPath(storage.path, storage.source)
    : await findActiveStoragePath(storage);
  return activeFile ? { storage, activeFile } : null;
}

async function readStorageTurns(storage: FoundStorageResult, activePath: string): Promise<TokenTurn[]> {
  let turns: TokenTurn[];
  if (storage.source === "codex" && storage.format === "sqlite") {
    turns = readCodexSqliteTurns(activePath);
    return turns.map((turn) => ({ ...turn, goal: storage.goal ?? null }));
  }
  const parser = storage.source === "claude"
    ? createClaudeParser().parseLine
    : createCodexJsonlParser({ model: storage.model }).parseLine;
  turns = await readParsedLines(activePath, parser);
  return storage.source === "codex"
    ? turns.map((turn) => ({ ...turn, goal: storage.goal ?? null }))
    : turns;
}

async function findActiveStoragePath(storage: FoundStorageResult): Promise<ActiveSessionFile | null> {
  const inspected = await Promise.all(storage.paths.map((path) => inspectPath(path, storage.source)));
  return findMostRecentSessionFile(inspected.filter((file) => file !== null));
}

function readCodexSqliteTurns(path: string): TokenTurn[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    return readCodexTurnsSince(db, 0).turns;
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

async function nextAvailablePath(outDir: string, date: string, extension: "md" | "csv"): Promise<string> {
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

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  if (!relativePath || relativePath.startsWith("..")) {
    return path;
  }
  return relativePath;
}
