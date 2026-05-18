import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { ClaudeStorageResult, CodexStorageResult, FoundStorageResult, SessionSource, StorageFormat } from "./types.js";

const JSONL_LIMIT = 10_000;
const CODEX_MISSING_DETAIL = "set CODEX_HOME or start a Codex session";
const CLAUDE_MISSING_DETAIL = "set CLAUDE_HOME or start a Claude Code session";
const CODEX_ACTIVE_THREAD_WINDOW_MS = 300_000;
const CODEX_WAITING_DETAIL = "codex \u2192 waiting for session...";

interface DetectOptions {
  codexHome?: string;
  claudeHome?: string;
  defaultCodexHome?: string;
  defaultClaudeHome?: string;
  codexDbPath?: string;
  claudeGlob?: string;
}

interface CandidateBase {
  path: string;
  label: string;
}

interface CodexThreadRow {
  rolloutPath: string | null;
  model: string | null;
}

export function detectCodexStorage(options: DetectOptions = {}): CodexStorageResult {
  const warnings: string[] = [];
  const bases = buildBases(
    options.codexHome ?? process.env.CODEX_HOME,
    options.defaultCodexHome ?? join(homedir(), ".codex"),
    "CODEX_HOME"
  );

  if (options.codexDbPath) {
    const explicit = basename(options.codexDbPath) === "state_5.sqlite"
      ? detectCodexStateSqlite(options.codexDbPath, "--codex-db", warnings)
      : detectCodexSqlite(options.codexDbPath, "--codex-db", warnings);
    if (explicit) {
      return explicit;
    }
  }

  for (const base of bases) {
    const stateSqlite = detectCodexStateSqlite(join(base.path, "state_5.sqlite"), `${base.label}/state_5.sqlite`, warnings);
    if (stateSqlite) {
      return stateSqlite;
    }

    const sqlite = detectCodexSqlite(join(base.path, "logs_2.sqlite"), `${base.label}/logs_2.sqlite`, warnings);
    if (sqlite) {
      return sqlite;
    }

    const sessionsDir = join(base.path, "sessions");
    const sessionFiles = findJsonlFiles(sessionsDir, true);
    if (sessionFiles.length > 0) {
      return foundStorage("codex", "jsonl", sessionsDir, sessionFiles, `${base.label}/sessions/**/*.jsonl`, warnings);
    }

    const directJsonl = findJsonlFiles(base.path, false);
    if (directJsonl.length > 0) {
      return foundStorage("codex", "jsonl", base.path, directJsonl, `${base.label}/*.jsonl`, warnings);
    }

    const logDir = join(base.path, "log");
    const logFiles = findRelevantLogFiles(logDir);
    if (logFiles.length > 0) {
      return foundStorage("codex", "log", logDir, logFiles, `${base.label}/log/`, warnings);
    }
  }

  return missingStorage("codex", CODEX_MISSING_DETAIL, warnings);
}

export function detectClaudeStorage(options: DetectOptions = {}): ClaudeStorageResult {
  const warnings: string[] = [];

  if (options.claudeGlob) {
    const files = findFilesForSimpleJsonlGlob(options.claudeGlob);
    if (files.length > 0) {
      return foundStorage("claude", "jsonl", options.claudeGlob, files, options.claudeGlob, warnings);
    }
    return missingStorage("claude", `no files matched --claude-glob (${options.claudeGlob})`, warnings);
  }

  const bases = buildBases(
    options.claudeHome ?? process.env.CLAUDE_HOME,
    options.defaultClaudeHome ?? join(homedir(), ".claude"),
    "CLAUDE_HOME"
  );

  for (const base of bases) {
    const projectsDir = join(base.path, "projects");
    const projectFiles = findJsonlFiles(projectsDir, true);
    if (projectFiles.length > 0) {
      return foundStorage("claude", "jsonl", projectsDir, projectFiles, `${base.label}/projects/**/*.jsonl`, warnings);
    }

    const directJsonl = findJsonlFiles(base.path, false);
    if (directJsonl.length > 0) {
      return foundStorage("claude", "jsonl", base.path, directJsonl, `${base.label}/*.jsonl`, warnings);
    }

    const dataDir = join(base.path, ".data");
    const dataFiles = findJsonlFiles(dataDir, true);
    if (dataFiles.length > 0) {
      return foundStorage("claude", "jsonl", dataDir, dataFiles, `${base.label}/.data/**/*.jsonl`, warnings);
    }
  }

  return missingStorage("claude", CLAUDE_MISSING_DETAIL, warnings);
}

function detectCodexStateSqlite(
  path: string,
  detail: string,
  warnings: string[]
): CodexStorageResult | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    if (!statSync(path).isFile()) {
      warnings.push(`${displayPath(path)}: Codex state SQLite path is not a file; falling back`);
      return null;
    }
    accessSync(path, constants.R_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${displayPath(path)}: Codex state SQLite is unreadable (${message}); falling back`);
    return null;
  }

  const active = readActiveCodexThread(path, warnings);
  if (!active) {
    return null;
  }
  if (active.kind === "waiting") {
    return missingStorage("codex", CODEX_WAITING_DETAIL, warnings);
  }

  return foundStorage(
    "codex",
    "jsonl",
    active.rolloutPath,
    [active.rolloutPath],
    `${detail} → threads.rollout_path`,
    warnings,
    active.model
  );
}

function detectCodexSqlite(
  path: string,
  detail: string,
  warnings: string[]
): CodexStorageResult | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    if (!statSync(path).isFile()) {
      warnings.push(`${displayPath(path)}: Codex SQLite path is not a file; falling back`);
      return null;
    }
    accessSync(path, constants.R_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${displayPath(path)}: Codex SQLite is unreadable (${message}); falling back`);
    return null;
  }

  const validation = validateCodexSqlite(path);
  if (!validation.valid) {
    warnings.push(`${displayPath(path)}: ${validation.warning}`);
    return null;
  }

  return foundStorage("codex", "sqlite", path, [path], detail, warnings);
}

function validateCodexSqlite(path: string): { valid: true } | { valid: false; warning: string } {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const rows = db.prepare("PRAGMA table_info(logs)").all() as Array<{ name?: string }>;
    const columns = new Set(rows.map((row) => row.name).filter(Boolean));
    if (!columns.has("id") || !columns.has("target") || !columns.has("feedback_log_body")) {
      return {
        valid: false,
        warning: "Codex SQLite schema is missing expected logs.id, logs.target, or logs.feedback_log_body columns; falling back"
      };
    }
    db.prepare("SELECT MAX(id) AS maxRowId FROM logs").get();
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, warning: `Codex SQLite could not be read (${message}); falling back` };
  } finally {
    if (db?.open) {
      db.close();
    }
  }
}

function readActiveCodexThread(
  path: string,
  warnings: string[]
): { kind: "active"; rolloutPath: string; model: string } | { kind: "waiting" } | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const cutoffMs = Date.now() - CODEX_ACTIVE_THREAD_WINDOW_MS;
    const row = db
      .prepare<[number], CodexThreadRow>(`
        SELECT rollout_path AS rolloutPath, model AS model
        FROM threads
        WHERE rollout_path IS NOT NULL
          AND rollout_path != ''
          AND updated_at_ms > ?
        ORDER BY updated_at_ms DESC
        LIMIT 1
      `)
      .get(cutoffMs);
    if (!row) {
      return { kind: "waiting" };
    }
    if (!row?.rolloutPath || !isReadableFile(row.rolloutPath)) {
      warnings.push(`${displayPath(path)}: no readable Codex rollout path in threads.rollout_path; falling back`);
      return null;
    }

    return {
      kind: "active",
      rolloutPath: row.rolloutPath,
      model: row.model ?? "unknown"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${displayPath(path)}: Codex state SQLite could not be read (${message}); falling back`);
    return null;
  } finally {
    if (db?.open) {
      db.close();
    }
  }
}

function buildBases(envHome: string | undefined, defaultHome: string, envName: string): CandidateBase[] {
  const bases: CandidateBase[] = [];
  const normalizedEnv = envHome?.trim();
  if (normalizedEnv) {
    bases.push({ path: resolve(expandHome(normalizedEnv)), label: `$${envName}` });
  }
  const normalizedDefault = resolve(expandHome(defaultHome));
  if (!bases.some((base) => base.path === normalizedDefault)) {
    bases.push({ path: normalizedDefault, label: displayPath(normalizedDefault) });
  }
  return bases;
}

function foundStorage<T extends SessionSource>(
  source: T,
  format: Exclude<StorageFormat, "none">,
  path: string,
  paths: string[],
  detail: string,
  warnings: string[],
  model?: string
): FoundStorageResult & { source: T } {
  const sortedPaths = paths.sort((a, b) => getMtimeMs(b) - getMtimeMs(a));
  return {
    source,
    status: "found",
    format,
    path,
    paths: sortedPaths,
    pattern: inferWatchPattern(path, sortedPaths, detail),
    model,
    detail,
    warnings: [...warnings]
  };
}

function missingStorage<T extends SessionSource>(
  source: T,
  detail: string,
  warnings: string[]
): (T extends "codex" ? CodexStorageResult : ClaudeStorageResult) {
  return {
    source,
    status: "missing",
    format: "none",
    path: null,
    paths: [],
    detail,
    warnings: [...warnings]
  } as T extends "codex" ? CodexStorageResult : ClaudeStorageResult;
}

function findFilesForSimpleJsonlGlob(pattern: string): string[] {
  if (pattern.endsWith("/**/*.jsonl")) {
    return findJsonlFiles(pattern.slice(0, -"/**/*.jsonl".length), true);
  }
  if (pattern.endsWith("/*.jsonl")) {
    return findJsonlFiles(pattern.slice(0, -"/*.jsonl".length), false);
  }
  if (pattern.endsWith(".jsonl") && isReadableFile(pattern)) {
    return [pattern];
  }
  return [];
}

function findJsonlFiles(dir: string, recursive: boolean): string[] {
  return findFiles(dir, recursive, (path) => path.endsWith(".jsonl"));
}

function findRelevantLogFiles(dir: string): string[] {
  return findFiles(dir, false, (path) => {
    const name = basename(path);
    return name.endsWith(".log") || name.endsWith(".jsonl");
  });
}

function findFiles(dir: string, recursive: boolean, predicate: (path: string) => boolean): string[] {
  if (!isReadableDirectory(dir)) {
    return [];
  }

  const files: string[] = [];
  const visit = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= JSONL_LIMIT) {
        return;
      }
      const path = join(current, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory() && recursive) {
        visit(path);
      } else if (stat.isFile() && predicate(path) && isReadableFile(path)) {
        files.push(path);
      }
    }
  };

  visit(dir);
  return files;
}

function isReadableFile(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isReadableDirectory(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return false;
    }
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function inferWatchPattern(path: string, paths: readonly string[], detail: string): string | undefined {
  if (detail.includes("**/*.jsonl")) {
    return join(path, "**/*.jsonl");
  }
  if (detail.includes("/*.jsonl")) {
    return join(path, "*.jsonl");
  }
  if (paths.length === 1 && paths[0] === path) {
    return path;
  }
  return undefined;
}

function getMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
