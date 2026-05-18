import assert from "node:assert/strict";
import test from "node:test";
import { createDoctorReport } from "../dist/doctor.js";
import { collectSessionCandidates, renderSessionList, renderSessionListJson, resolveSessionSelection } from "../dist/sessions.js";

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

  const json = JSON.parse(renderSessionListJson(summary));
  assert.equal(json.sessions.length, 2);
  assert.equal(json.sessions[0].source, "claude");
  assert.equal(json.sessions[1].format, "sqlite");
  assert.deepEqual(json.warnings, ["schema fallback warning"]);
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

test("doctor report validates ready, degraded, missing, and config-error setup states", () => {
  const ready = createDoctorReport({
    ...readyInput(),
    summary: {
      claude: summary.claude,
      codex: {
        ...summary.codex,
        warnings: []
      }
    },
    candidates: collectSessionCandidates({
      claude: summary.claude,
      codex: {
        ...summary.codex,
        warnings: []
      }
    })
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.exitCode, 0);
  assert.equal(ready.json.status, "ready");
  assert.equal(ready.json.exitCode, 0);
  assert.equal(ready.json.promptVisibility[0].activeSessions, 1);
  assert.match(ready.json.suggestedCommands[0], /tokenwatch --session/);
  assert.match(ready.text, /tokenwatch doctor/);
  assert.match(ready.text, /Storage:\n- Claude Code: found jsonl/);
  assert.match(ready.text, /- Codex CLI: found sqlite/);
  assert.match(ready.text, /tokenwatch --session "\/tmp\/codex\/logs_2\.sqlite" --session-source codex/);

  const degraded = createDoctorReport({
    summary,
    candidates: collectSessionCandidates(summary),
    config: {
      path: "/tmp/.tokenwatch/config.json",
      status: "valid",
      detail: "valid JSON; unsupported values are ignored",
      config: {
        dailyBudgetUsd: 5,
        weeklyBudgetUsd: null,
        alertAt: 0.8,
        topicRules: [{ topic: "billing", keywords: ["stripe"] }],
        redactPromptText: true
      }
    },
    pricing: {
      verifiedAt: "2026-05-18",
      ageDays: 0,
      staleAfterDays: 90,
      stale: false,
      sources: []
    },
    version: "0.1.0",
    nodeVersion: "v22.0.0",
    env: {
      CODEX_HOME: "/tmp/codex",
      CLAUDE_HOME: "/tmp/claude"
    }
  });

  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.exitCode, 1);
  assert.match(degraded.text, /Redaction: enabled/);
  assert.match(degraded.text, /Warnings:\n- schema fallback warning/);

  const noSources = createDoctorReport({
    ...readyInput(),
    summary: {
      claude: {
        source: "claude",
        status: "missing",
        format: "none",
        path: null,
        paths: [],
        detail: "set CLAUDE_HOME or start a Claude Code session",
        warnings: []
      },
      codex: {
        source: "codex",
        status: "missing",
        format: "none",
        path: null,
        paths: [],
        detail: "set CODEX_HOME or start a Codex session",
        warnings: []
      }
    },
    candidates: []
  });
  assert.equal(noSources.status, "missing");
  assert.equal(noSources.exitCode, 2);
  assert.match(noSources.text, /Start Claude Code or Codex CLI/);

  const configError = createDoctorReport({
    ...readyInput(),
    config: {
      ...readyInput().config,
      status: "invalid",
      detail: "invalid JSON; using defaults"
    }
  });
  assert.equal(configError.status, "config-error");
  assert.equal(configError.exitCode, 3);
  assert.match(configError.text, /Status: config-error/);
});

function readyInput() {
  return {
    summary,
    candidates: collectSessionCandidates(summary),
    config: {
      path: "/tmp/.tokenwatch/config.json",
      status: "valid",
      detail: "valid JSON; unsupported values are ignored",
      config: {
        dailyBudgetUsd: null,
        weeklyBudgetUsd: null,
        alertAt: 0.8,
        topicRules: [],
        redactPromptText: false
      }
    },
    pricing: {
      verifiedAt: "2026-05-18",
      ageDays: 0,
      staleAfterDays: 90,
      stale: false,
      sources: []
    },
    version: "0.1.0",
    nodeVersion: "v22.0.0",
    env: {}
  };
}
