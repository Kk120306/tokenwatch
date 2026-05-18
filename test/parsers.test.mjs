import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseClaudeLine } from "../dist/parsers/claude.js";
import { CodexDeltaParser, parseCodexLines } from "../dist/parsers/codex.js";

test("Claude parser extracts assistant message usage", async () => {
  const lines = (await readFile("test/fixtures/claude.jsonl", "utf8")).split("\n");
  const turns = lines.map(parseClaudeLine).filter(Boolean);

  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0], {
    source: "claude",
    model: "claude-sonnet-4-6",
    usage: {
      inputTokens: 1842,
      cachedInputTokens: 1200,
      outputTokens: 347
    }
  });
});

test("Codex parser diffs cumulative token_count events", async () => {
  const lines = (await readFile("test/fixtures/codex.jsonl", "utf8")).split("\n");
  const turns = parseCodexLines(lines);

  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0], {
    source: "codex",
    model: "gpt-5",
    usage: {
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 200
    }
  });
  assert.deepEqual(turns[1], {
    source: "codex",
    model: "gpt-5",
    usage: {
      inputTokens: 400,
      cachedInputTokens: 200,
      outputTokens: 150
    }
  });
});

test("Codex parser ignores malformed and unrelated lines", () => {
  const parser = new CodexDeltaParser();

  assert.equal(parser.parseLine(""), null);
  assert.equal(parser.parseLine("not json"), null);
  assert.equal(parser.parseLine(JSON.stringify({ type: "message", text: "ignored" })), null);
});
