import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PricingTable, TokenUsage } from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultPricingPath = resolve(currentDir, "../pricing.json");
const MS_PER_DAY = 86_400_000;

export const PRICING_VERIFIED_AT = "2026-05-18";
export const PRICING_STALE_AFTER_DAYS = 90;
export const PRICING_SOURCES = [
  "https://openai.com/api/pricing/",
  "https://platform.openai.com/docs/pricing",
  "https://platform.claude.com/docs/en/about-claude/pricing"
] as const;

export interface PricingFreshness {
  verifiedAt: string;
  ageDays: number;
  staleAfterDays: number;
  stale: boolean;
  sources: readonly string[];
}

export interface PricingResolution {
  requestedModel: string;
  matchedModel: string;
  exact: boolean;
}

export interface PricingReport {
  schemaVersion: 1;
  freshness: PricingFreshness;
  scope: string;
  matching: string;
  models: Array<{
    model: string;
    inputPerMillion: number;
    cachedInputPerMillion: number;
    outputPerMillion: number;
  }>;
}

interface PricingArgs {
  help: boolean;
  json: boolean;
}

const PRICING_SCOPE = "standard first-party API token rates; batch, regional, fast-mode, and marketplace modifiers are not applied.";
const PRICING_MATCHING = "exact model keys first; date-suffixed snapshot IDs fall back to the bundled base key when available.";

export function loadPricing(path = defaultPricingPath): PricingTable {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PricingTable;
}

export function resolvePricingModel(
  model: string,
  pricing: PricingTable
): PricingResolution | null {
  const candidates = pricingModelCandidates(model);
  for (const candidate of candidates) {
    if (pricing[candidate]) {
      return {
        requestedModel: model,
        matchedModel: candidate,
        exact: candidate === model.trim()
      };
    }
  }
  return null;
}

export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  pricing: PricingTable
): number {
  const resolved = resolvePricingModel(model, pricing);
  const entry = resolved ? pricing[resolved.matchedModel] : undefined;
  if (!entry) {
    return 0;
  }

  return (
    (usage.inputTokens / 1_000_000) * entry.inputPerMillion +
    (usage.cachedInputTokens / 1_000_000) * entry.cachedInputPerMillion +
    (usage.outputTokens / 1_000_000) * entry.outputPerMillion
  );
}

export function estimateCacheSavingsUsd(
  model: string,
  cachedTokens: number,
  pricing: PricingTable
): number {
  const resolved = resolvePricingModel(model, pricing);
  const entry = resolved ? pricing[resolved.matchedModel] : undefined;
  if (!entry) {
    return 0;
  }

  return (
    (cachedTokens / 1_000_000) *
    Math.max(0, entry.inputPerMillion - entry.cachedInputPerMillion)
  );
}

export function getPricingFreshness(now = new Date()): PricingFreshness {
  const verifiedAt = new Date(`${PRICING_VERIFIED_AT}T00:00:00.000Z`);
  const ageDays = Math.max(0, Math.floor((now.getTime() - verifiedAt.getTime()) / MS_PER_DAY));
  return {
    verifiedAt: PRICING_VERIFIED_AT,
    ageDays,
    staleAfterDays: PRICING_STALE_AFTER_DAYS,
    stale: ageDays > PRICING_STALE_AFTER_DAYS,
    sources: PRICING_SOURCES
  };
}

export function runPricing(argv: readonly string[] = []): void {
  const args = parsePricingArgs(argv);
  if (args.help) {
    console.log(renderPricingHelp().trimEnd());
    return;
  }

  const pricing = loadPricing();
  process.stdout.write(args.json ? renderPricingJson(pricing) : renderPricingInfo(pricing));
}

export function createPricingReport(
  pricing: PricingTable,
  now = new Date()
): PricingReport {
  return {
    schemaVersion: 1,
    freshness: getPricingFreshness(now),
    scope: PRICING_SCOPE,
    matching: PRICING_MATCHING,
    models: Object.entries(pricing)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([model, entry]) => ({
        model,
        inputPerMillion: entry.inputPerMillion,
        cachedInputPerMillion: entry.cachedInputPerMillion,
        outputPerMillion: entry.outputPerMillion
      }))
  };
}

export function renderPricingJson(
  pricing: PricingTable,
  now = new Date()
): string {
  return `${JSON.stringify(createPricingReport(pricing, now), null, 2)}\n`;
}

export function renderPricingInfo(
  pricing: PricingTable,
  now = new Date()
): string {
  const freshness = getPricingFreshness(now);
  const status = freshness.stale ? "stale" : "fresh";
  const lines = [
    "Bundled pricing",
    `Verified: ${freshness.verifiedAt}`,
    `Status: ${status} (${freshness.ageDays} days old; stale after ${freshness.staleAfterDays} days)`,
    `Scope: ${PRICING_SCOPE}`,
    `Matching: ${PRICING_MATCHING}`,
    "",
    "Sources:",
    ...freshness.sources.map((source) => `- ${source}`),
    "",
    `Models: ${Object.keys(pricing).length}`,
    ...Object.entries(pricing)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([model, entry]) => `${model}: input $${formatRate(entry.inputPerMillion)} / cached $${formatRate(entry.cachedInputPerMillion)} / output $${formatRate(entry.outputPerMillion)} per 1M tokens`)
  ];
  return `${lines.join("\n")}\n`;
}

export function renderPricingHelp(): string {
  return `tokenwatch pricing

Usage:
  tokenwatch pricing [--json]

Options:
  --json       Print bundled pricing metadata and model rates as JSON
  -h, --help   Show this help.
`;
}

function parsePricingArgs(argv: readonly string[]): PricingArgs {
  const args: PricingArgs = { help: false, json: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    throw new Error(`Unknown pricing argument: ${arg}`);
  }
  return args;
}

function pricingModelCandidates(model: string): string[] {
  const normalized = model.trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  addCandidate(candidates, stripDateSuffix(normalized));
  return candidates;
}

function stripDateSuffix(model: string): string {
  return model
    .replace(/-(?:20\d{2}-\d{2}-\d{2}|\d{8})$/, "")
    .replace(/-(?:20\d{2}-\d{2}-\d{2}|\d{8})$/, "");
}

function addCandidate(candidates: string[], candidate: string): void {
  if (candidate && !candidates.includes(candidate)) {
    candidates.push(candidate);
  }
}

function formatRate(value: number): string {
  const trimmed = value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const [, fraction = ""] = trimmed.split(".");
  if (fraction.length === 0) {
    return `${trimmed}.00`;
  }
  if (fraction.length === 1) {
    return `${trimmed}0`;
  }
  return trimmed;
}
