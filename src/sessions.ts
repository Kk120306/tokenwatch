import { homedir } from "node:os";
import { basename } from "node:path";
import { detectClaudeStorage, detectCodexStorage } from "./detect.js";
import type { SessionSource, StorageDetectionSummary, StorageResult } from "./types.js";

export interface SessionCandidate {
  source: SessionSource;
  format: string;
  path: string;
  active: boolean;
  promptVisibility: string;
}

export interface SessionSelection {
  source: SessionSource;
  claudeGlob?: string;
  codexDbPath?: string;
  codexSessionPath?: string;
}

interface SessionListReport {
  sources: StorageDetectionSummary;
  sessions: SessionCandidate[];
  warnings: string[];
}

export function detectSessionSummary(): StorageDetectionSummary {
  return {
    claude: detectClaudeStorage(),
    codex: detectCodexStorage()
  };
}

export function collectSessionCandidates(summary: StorageDetectionSummary): SessionCandidate[] {
  return [
    ...candidatesFromStorage(summary.claude),
    ...candidatesFromStorage(summary.codex)
  ];
}

export function renderSessionList(summary: StorageDetectionSummary): string {
  const candidates = collectSessionCandidates(summary);
  const lines: string[] = [];
  if (candidates.length === 0) {
    lines.push("No tokenwatch sessions detected.");
    lines.push(`Claude Code: ${summary.claude.detail}`);
    lines.push(`Codex CLI: ${summary.codex.detail}`);
  } else {
    lines.push("Detected tokenwatch sessions:");
    for (const [index, candidate] of candidates.entries()) {
      const active = candidate.active ? " active" : "";
      lines.push(
        `${index + 1}. ${candidate.source} ${candidate.format}${active}  ${displayPath(candidate.path)}`
      );
      lines.push(`   ${candidate.promptVisibility}`);
      lines.push(`   watch: tokenwatch --session "${candidate.path}" --session-source ${candidate.source}`);
    }
  }

  const warnings = [...summary.claude.warnings, ...summary.codex.warnings];
  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function createSessionListReport(summary: StorageDetectionSummary): SessionListReport {
  return {
    sources: summary,
    sessions: collectSessionCandidates(summary),
    warnings: [...summary.claude.warnings, ...summary.codex.warnings]
  };
}

export function renderSessionListJson(summary: StorageDetectionSummary): string {
  return `${JSON.stringify(createSessionListReport(summary), null, 2)}\n`;
}

export function resolveSessionSelection(
  path: string,
  explicitSource?: SessionSource
): SessionSelection {
  const source = explicitSource ?? inferSessionSource(path);
  if (!source) {
    throw new Error(`Could not infer session source for ${path}; pass --session-source claude or --session-source codex`);
  }

  if (source === "claude") {
    return {
      source,
      claudeGlob: path
    };
  }

  const name = basename(path);
  return {
    source,
    codexDbPath: name.endsWith(".sqlite") ? path : undefined,
    codexSessionPath: name.endsWith(".sqlite") ? undefined : path
  };
}

function candidatesFromStorage(result: StorageResult): SessionCandidate[] {
  if (result.status !== "found") {
    return [];
  }
  return result.paths.map((path) => ({
    source: result.source,
    format: result.format,
    path,
    active: path === result.path || path === result.paths[0],
    promptVisibility: promptVisibilityFor(result)
  }));
}

function promptVisibilityFor(result: StorageResult): string {
  if (result.source === "claude") {
    return "Prompt text plus usage when user and assistant JSONL entries are paired.";
  }
  if (result.format === "sqlite") {
    return "Usage is available; prompt text is best-effort from user-message telemetry.";
  }
  if (result.format === "jsonl") {
    return "Prompt text plus token usage when rollout user and token_count events are paired.";
  }
  return "Usage is parsed from local Codex log text when structured events are present.";
}

function inferSessionSource(path: string): SessionSource | null {
  const normalized = path.toLowerCase();
  const name = basename(normalized);
  if (name.endsWith(".sqlite")) {
    return "codex";
  }
  if (normalized.includes("/.claude/") || normalized.includes("/claude/")) {
    return "claude";
  }
  if (normalized.includes("/.codex/") || normalized.includes("/codex/") || name.startsWith("rollout-")) {
    return "codex";
  }
  return null;
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
