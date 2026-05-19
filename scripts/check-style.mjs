#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".json", ".md", ".yml", ".yaml"]);
const SKIP_DIRS = new Set([".git", ".npm-cache", "dist", "node_modules", "test/tmp"]);
const TOP_LEVEL_FILES = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "package.json", "pricing.json", "tsconfig.json"];
const TOP_LEVEL_DIRS = [".github", "docs", "scripts", "src", "test"];

const failures = [];
let checked = 0;

for (const file of TOP_LEVEL_FILES) {
  await checkFile(join(ROOT, file));
}
for (const dir of TOP_LEVEL_DIRS) {
  await walk(join(ROOT, dir));
}

if (failures.length > 0) {
  console.error("Style check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`style check passed (${checked} files)`);

async function walk(dir) {
  const relativeDir = relativeFromRoot(dir);
  if (SKIP_DIRS.has(relativeDir)) {
    return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    failures.push(`${relativeDir}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    const relativePath = relativeFromRoot(path);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(relativePath)) {
        await walk(path);
      }
      continue;
    }
    if (!entry.isFile() || !isTextFile(entry.name)) {
      continue;
    }
    await checkFile(path);
  }
}

async function checkFile(path) {
  if (!isTextFile(path)) {
    return;
  }
  checked += 1;
  const relativePath = relativeFromRoot(path);
  const text = await readFile(path, "utf8");
  if (text.includes("\r")) {
    failures.push(`${relativePath}: contains CRLF line endings`);
  }
  if (text.length > 0 && !text.endsWith("\n")) {
    failures.push(`${relativePath}: missing final newline`);
  }

  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: trailing whitespace`);
    }
    if (/\t/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: tab indentation`);
    }
  }
}

function isTextFile(path) {
  return TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf(".")));
}

function relativeFromRoot(path) {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}
