import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseClaudeLine } from "../dist/parsers/claude.js";
import { parseCodexFeedbackLogBody, parseCodexLogRow } from "../dist/parsers/codex.js";

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

test("Codex parser extracts response.completed usage from SQLite log rows", async () => {
  const body = await readFile("test/fixtures/codex-response-completed.txt", "utf8");

  assert.deepEqual(parseCodexLogRow({ rowid: 4997629, feedback_log_body: body }), {
    source: "codex",
    model: "gpt-5.5",
    usage: {
      inputTokens: 33372,
      cachedInputTokens: 32128,
      outputTokens: 102
    }
  });
});

test("Codex parser supports legacy cached_input_tokens shape in response usage", () => {
  const body = JSON.stringify({
    type: "response.completed",
    response: {
      model: "gpt-5",
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 250,
        output_tokens: 50
      }
    }
  });

  assert.deepEqual(parseCodexFeedbackLogBody(body), {
    source: "codex",
    model: "gpt-5",
    usage: {
      inputTokens: 1000,
      cachedInputTokens: 250,
      outputTokens: 50
    }
  });
});

test("Codex parser ignores malformed and unrelated SQLite log rows", () => {
  assert.equal(parseCodexFeedbackLogBody(""), null);
  assert.equal(parseCodexFeedbackLogBody("not json"), null);
  assert.equal(parseCodexFeedbackLogBody("Received message not json"), null);
  assert.equal(
    parseCodexFeedbackLogBody(JSON.stringify({ type: "response.output_item.done" })),
    null
  );
  assert.equal(
    parseCodexLogRow({ rowid: 1, feedback_log_body: "Received message {\"type\":\"response.completed\"}" }),
    null
  );
});
