import assert from "node:assert/strict";
import test from "node:test";

process.env.FORCE_COLOR = "1";

test("display applies chalk styles for high-cost prompts and totals", async () => {
  const { formatSessionTotal, formatTurn } = await import("../dist/display.js");
  const highCostTurn = {
    source: "codex",
    model: "gpt-5",
    index: 9,
    costUsd: 0.02,
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1
    }
  };

  assert.match(formatTurn(highCostTurn), /\u001b\[33m/);
  assert.match(
    formatSessionTotal({
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      costUsd: 0.02
    }),
    /\u001b\[2m/
  );
});
