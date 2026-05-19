#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [readme, indexSource, exportRunner, initSource, pricingSource, pricingJsonRaw] = await Promise.all([
  readFile("README.md", "utf8"),
  readFile("src/index.ts", "utf8"),
  readFile("src/export/runner.ts", "utf8"),
  readFile("src/init.ts", "utf8"),
  readFile("src/pricing.ts", "utf8"),
  readFile("pricing.json", "utf8")
]);

const failures = [];

requireSnippets("README.md", readme, [
  "tokenwatch init [--json]",
  "tokenwatch sessions [--json|--commands]",
  "tokenwatch doctor [--json]",
  "tokenwatch pricing [--json]",
  "`--stdout`",
  "`--preset <name>`",
  "`--all-sessions`",
  "`--since <date>`",
  "`--until <date>`",
  "`--model <name>`",
  "`--topic <name>`",
  "schemaVersion: 1"
]);

requireSnippets("src/index.ts", indexSource, [
  "tokenwatch init [--json]",
  "tokenwatch pricing [--json]",
  "--preset <name>",
  "--all-sessions",
  "--stdout"
]);

requireSnippets("src/export/runner.ts", exportRunner, [
  "tokenwatch export [--md|--csv|--json]",
  "--all-sessions",
  "--stdout",
  "--preset <name>",
  "--since <date>",
  "--until <date>",
  "--model <name>",
  "--topic <name>"
]);

requireSnippets("src/init.ts", initSource, [
  "tokenwatch init [--json]",
  "--json                  Print a machine-readable setup report"
]);

requireSnippets("src/pricing.ts", pricingSource, [
  "tokenwatch pricing [--json]",
  "schemaVersion: 1"
]);

const pricingKeys = Object.keys(JSON.parse(pricingJsonRaw)).sort((left, right) => left.localeCompare(right));
for (const key of pricingKeys) {
  if (!readme.includes(`- \`${key}\``)) {
    failures.push(`README.md: missing bundled pricing key ${key}`);
  }
}

if (failures.length > 0) {
  console.error("Docs sync check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`docs sync check passed (${pricingKeys.length} pricing keys)`);

function requireSnippets(label, text, snippets) {
  for (const snippet of snippets) {
    if (!text.includes(snippet)) {
      failures.push(`${label}: missing ${snippet}`);
    }
  }
}
