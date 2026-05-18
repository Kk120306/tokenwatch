import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getTokenwatchDir, loadConfig, type TokenwatchConfig } from "./config.js";
import { getPricingFreshness, type PricingFreshness } from "./pricing.js";
import { collectSessionCandidates, detectSessionSummary, type SessionCandidate } from "./sessions.js";
import type { StorageDetectionSummary, StorageResult } from "./types.js";

type DoctorStatus = "ready" | "degraded" | "missing" | "config-error";

interface ConfigDiagnostics {
  path: string;
  status: "missing" | "valid" | "invalid";
  detail: string;
  config: TokenwatchConfig;
}

interface DoctorInput {
  summary: StorageDetectionSummary;
  candidates: readonly SessionCandidate[];
  config: ConfigDiagnostics;
  pricing: PricingFreshness;
  version: string;
  nodeVersion: string;
  env: NodeJS.ProcessEnv;
}

interface DoctorJsonReport {
  status: DoctorStatus;
  exitCode: number;
  version: string;
  nodeVersion: string;
  environment: {
    CODEX_HOME: string | null;
    CLAUDE_HOME: string | null;
  };
  storage: StorageDetectionSummary;
  promptVisibility: Array<{
    source: SessionCandidate["source"];
    format: SessionCandidate["format"];
    sessions: number;
    activeSessions: number;
    detail: string;
  }>;
  config: ConfigDiagnostics;
  pricing: PricingFreshness;
  suggestedCommands: string[];
  warnings: string[];
}

export interface DoctorReport {
  status: DoctorStatus;
  exitCode: number;
  text: string;
  json: DoctorJsonReport;
}

interface DoctorArgs {
  help: boolean;
  json: boolean;
}

export function runDoctor(argv: readonly string[] = [], version = "0.0.0"): void {
  const args = parseDoctorArgs(argv);
  if (args.help) {
    printDoctorHelp();
    return;
  }
  const report = createDoctorReport(createDoctorInput(version));
  console.log(args.json ? JSON.stringify(report.json, null, 2) : report.text.trimEnd());
  process.exitCode = report.exitCode;
}

export function createDoctorReport(input: DoctorInput): DoctorReport {
  const warnings = [...input.summary.claude.warnings, ...input.summary.codex.warnings];
  const status = getDoctorStatus(input, warnings);
  const exitCode = doctorExitCode(status);
  const activeCandidates = input.candidates.filter((candidate) => candidate.active);
  const suggested = activeCandidates.length > 0 ? activeCandidates : input.candidates;
  const lines = [
    "tokenwatch doctor",
    `Status: ${status}`,
    `Version: tokenwatch ${input.version}`,
    `Node: ${input.nodeVersion}`,
    "",
    "Environment:",
    `- CODEX_HOME: ${envHomeLine(input.env.CODEX_HOME, ".codex")}`,
    `- CLAUDE_HOME: ${envHomeLine(input.env.CLAUDE_HOME, ".claude")}`,
    "",
    "Storage:",
    ...storageLines("Claude Code", input.summary.claude),
    ...storageLines("Codex CLI", input.summary.codex),
    "",
    "Prompt Visibility:",
    ...promptVisibilityLines(input.candidates),
    "",
    "Config:",
    ...configLines(input.config),
    "",
    "Pricing:",
    `- Verified: ${input.pricing.verifiedAt}`,
    `- Status: ${input.pricing.stale ? "stale" : "fresh"} (${input.pricing.ageDays} days old; stale after ${input.pricing.staleAfterDays} days)`,
    "",
    "Suggested Commands:",
    ...suggestedCommandLines(suggested),
    ...warningLines(warnings)
  ];

  return {
    status,
    exitCode,
    text: `${lines.join("\n")}\n`,
    json: {
      status,
      exitCode,
      version: input.version,
      nodeVersion: input.nodeVersion,
      environment: {
        CODEX_HOME: envValue(input.env.CODEX_HOME),
        CLAUDE_HOME: envValue(input.env.CLAUDE_HOME)
      },
      storage: input.summary,
      promptVisibility: promptVisibilityData(input.candidates),
      config: input.config,
      pricing: input.pricing,
      suggestedCommands: suggested.map((candidate) => `tokenwatch --session "${candidate.path}" --session-source ${candidate.source}`),
      warnings
    }
  };
}

function parseDoctorArgs(argv: readonly string[]): DoctorArgs {
  const args: DoctorArgs = { help: false, json: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    throw new Error(`Unknown doctor argument: ${arg}`);
  }
  return args;
}

function createDoctorInput(version: string): DoctorInput {
  const summary = detectSessionSummary();
  return {
    summary,
    candidates: collectSessionCandidates(summary),
    config: inspectConfig(),
    pricing: getPricingFreshness(),
    version,
    nodeVersion: process.version,
    env: process.env
  };
}

function inspectConfig(baseDir = getTokenwatchDir()): ConfigDiagnostics {
  const path = join(baseDir, "config.json");
  if (!existsSync(path)) {
    return {
      path,
      status: "missing",
      detail: "not found; using defaults",
      config: loadConfig(baseDir)
    };
  }

  try {
    JSON.parse(readFileSync(path, "utf8")) as unknown;
    return {
      path,
      status: "valid",
      detail: "valid JSON; unsupported values are ignored",
      config: loadConfig(baseDir)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path,
      status: "invalid",
      detail: `invalid JSON; using defaults (${message})`,
      config: loadConfig(baseDir)
    };
  }
}

function getDoctorStatus(input: DoctorInput, warnings: readonly string[]): DoctorStatus {
  if (input.config.status === "invalid") {
    return "config-error";
  }
  if (input.candidates.length === 0) {
    return "missing";
  }
  if (warnings.length > 0 || input.summary.claude.status === "missing" || input.summary.codex.status === "missing" || input.pricing.stale) {
    return "degraded";
  }
  return "ready";
}

function doctorExitCode(status: DoctorStatus): number {
  if (status === "ready") {
    return 0;
  }
  if (status === "degraded") {
    return 1;
  }
  if (status === "missing") {
    return 2;
  }
  return 3;
}

function storageLines(label: string, result: StorageResult): string[] {
  if (result.status === "missing") {
    return [
      `- ${label}: not detected`,
      `  Detail: ${result.detail}`
    ];
  }

  return [
    `- ${label}: found ${result.format}`,
    `  Path: ${displayPath(result.path)}`,
    `  Detail: ${result.detail}`
  ];
}

function promptVisibilityLines(candidates: readonly SessionCandidate[]): string[] {
  if (candidates.length === 0) {
    return ["- No prompt visibility available until a supported session is detected."];
  }

  const groups = new Map<string, { candidate: SessionCandidate; count: number; activeCount: number }>();
  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.format}:${candidate.promptVisibility}`;
    const existing = groups.get(key) ?? { candidate, count: 0, activeCount: 0 };
    existing.count += 1;
    existing.activeCount += candidate.active ? 1 : 0;
    groups.set(key, existing);
  }

  return [...groups.values()].map(({ candidate, count, activeCount }) => {
    const active = activeCount > 0 ? `, ${activeCount} active` : "";
    const countLabel = count === 1 ? "1 session" : `${count} sessions`;
    return `- ${candidate.source} ${candidate.format} (${countLabel}${active}): ${candidate.promptVisibility}`;
  });
}

function promptVisibilityData(candidates: readonly SessionCandidate[]): DoctorJsonReport["promptVisibility"] {
  const groups = new Map<string, { candidate: SessionCandidate; count: number; activeCount: number }>();
  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.format}:${candidate.promptVisibility}`;
    const existing = groups.get(key) ?? { candidate, count: 0, activeCount: 0 };
    existing.count += 1;
    existing.activeCount += candidate.active ? 1 : 0;
    groups.set(key, existing);
  }
  return [...groups.values()].map(({ candidate, count, activeCount }) => ({
    source: candidate.source,
    format: candidate.format,
    sessions: count,
    activeSessions: activeCount,
    detail: candidate.promptVisibility
  }));
}

function configLines(config: ConfigDiagnostics): string[] {
  return [
    `- Path: ${displayPath(config.path)}`,
    `- Status: ${config.status} (${config.detail})`,
    `- Daily budget: ${config.config.dailyBudgetUsd === null ? "none" : `$${config.config.dailyBudgetUsd}`}`,
    `- Weekly budget: ${config.config.weeklyBudgetUsd === null ? "none" : `$${config.config.weeklyBudgetUsd}`}`,
    `- Monthly budget: ${config.config.monthlyBudgetUsd === null ? "none" : `$${config.config.monthlyBudgetUsd}`}`,
    `- Redaction: ${config.config.redactPromptText ? "enabled" : "disabled"}`,
    `- Topic rules: ${config.config.topicRules.length}`
  ];
}

function suggestedCommandLines(candidates: readonly SessionCandidate[]): string[] {
  if (candidates.length === 0) {
    return [
      "- Start Claude Code or Codex CLI, send one prompt, then run tokenwatch doctor again.",
      "- If your logs live elsewhere, use --claude-glob, --codex-db, or --session."
    ];
  }

  return candidates.map((candidate) => `- tokenwatch --session "${candidate.path}" --session-source ${candidate.source}`);
}

function warningLines(warnings: readonly string[]): string[] {
  if (warnings.length === 0) {
    return [];
  }

  return [
    "",
    "Warnings:",
    ...warnings.map((warning) => `- ${warning}`)
  ];
}

function envHomeLine(value: string | undefined, defaultDir: ".codex" | ".claude"): string {
  const normalized = value?.trim();
  return normalized ? `${normalized} (set)` : `not set; default ${displayPath(join(homedir(), defaultDir))}`;
}

function envValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function printDoctorHelp(): void {
  console.log(`tokenwatch doctor

Usage:
  tokenwatch doctor [--json]

Options:
  --json       Print machine-readable setup diagnostics
  -h, --help   Show this help.
`);
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
