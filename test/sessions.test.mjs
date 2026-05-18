import assert from "node:assert/strict";
import test from "node:test";
import { collectSessionCandidates, renderSessionList, resolveSessionSelection } from "../dist/sessions.js";

const summary = {
  claude: {
    source: "claude",
    status: "found",
    format: "jsonl",
    path: "/tmp/claude/projects/session.jsonl",
    paths: ["/tmp/claude/projects/session.jsonl"],
    pattern: "/tmp/claude/projects/**/*.jsonl",
    detail: "$CLAUDE_HOME/projects/**/*.jsonl",
    warnings: []
  },
  codex: {
    source: "codex",
    status: "found",
    format: "sqlite",
    path: "/tmp/codex/logs_2.sqlite",
    paths: ["/tmp/codex/logs_2.sqlite"],
    detail: "$CODEX_HOME/logs_2.sqlite",
    warnings: ["schema fallback warning"]
  }
};

test("session listing renders detected source paths and watch commands", () => {
  const candidates = collectSessionCandidates(summary);
  assert.deepEqual(candidates.map((candidate) => [candidate.source, candidate.format, candidate.active]), [
    ["claude", "jsonl", true],
    ["codex", "sqlite", true]
  ]);

  const output = renderSessionList(summary);
  assert.match(output, /Detected tokenwatch sessions:/);
  assert.match(output, /1\. claude jsonl active  \/tmp\/claude\/projects\/session\.jsonl/);
  assert.match(output, /watch: tokenwatch --session "\/tmp\/claude\/projects\/session\.jsonl" --session-source claude/);
  assert.match(output, /2\. codex sqlite active  \/tmp\/codex\/logs_2\.sqlite/);
  assert.match(output, /Warnings:\n- schema fallback warning/);
});

test("session selection resolves explicit and inferred sources", () => {
  assert.deepEqual(resolveSessionSelection("/tmp/.claude/projects/session.jsonl"), {
    source: "claude",
    claudeGlob: "/tmp/.claude/projects/session.jsonl"
  });
  assert.deepEqual(resolveSessionSelection("/tmp/.codex/sessions/rollout.jsonl"), {
    source: "codex",
    codexDbPath: undefined,
    codexSessionPath: "/tmp/.codex/sessions/rollout.jsonl"
  });
  assert.deepEqual(resolveSessionSelection("/tmp/session.jsonl", "codex"), {
    source: "codex",
    codexDbPath: undefined,
    codexSessionPath: "/tmp/session.jsonl"
  });
  assert.throws(
    () => resolveSessionSelection("/tmp/session.jsonl"),
    /Could not infer session source/
  );
});
