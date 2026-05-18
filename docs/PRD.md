# tokenwatch PRD

## Summary

`tokenwatch` is a local-first terminal companion for Claude Code and Codex CLI. It detects supported local session storage, tails Claude Code JSONL, follows Codex CLI rollout JSONL when available, and polls Codex CLI SQLite/log fallbacks. It renders a live dashboard, reports token usage per visible prompt, tracks cache savings and budgets, and exports Markdown, CSV, or JSON reports. When a source exposes usage but not prompt text, tokenwatch still counts tokens and marks prompt text unavailable instead of guessing.

## Goals

- Provide live per-prompt token visibility without modifying either AI CLI.
- Support Claude Code JSONL logs with direct per-turn usage.
- Support Codex CLI rollout JSONL with prompt text and `token_count` usage.
- Support Codex CLI SQLite `response.completed` log rows with direct per-response usage and best-effort prompt attribution from preceding user-message telemetry.
- Help users select the correct local files with `tokenwatch init`, `tokenwatch doctor`, `tokenwatch sessions`, and command-only session output.
- Provide privacy-aware prompt redaction and explicit prompt visibility metadata.
- Keep the implementation local-first: TypeScript, Node 18+, bundled pricing, and no network pricing lookup.

## Requirements

- Watch `~/.claude/projects/**/*.jsonl` for Claude Code.
- Poll `~/.codex/logs_2.sqlite` for new Codex CLI rows every 1-2 seconds.
- Pick the most recently modified Claude JSONL file as the active Claude session.
- Claude Code parser reads entries where `type` is `assistant` and `message.usage` exists.
- Codex rollout parser pairs user prompt entries with `token_count` usage.
- Codex rollout parser can derive per-turn usage from cumulative `total_token_usage` deltas when explicit last-turn usage is absent.
- Codex SQLite parser reads `response.completed` rows, extracts `response.usage`, and attaches prompt text only when ordered user-message telemetry is present.
- Cost estimation uses bundled `pricing.json`; unknown models return `$0`.
- The dashboard shows prompt, model, and stats views with filtering, cache efficiency, context pressure, budget status, and model recommendations.
- Config supports prompt redaction, topic rules, alert threshold, and daily, weekly, and monthly budgets.
- Reports expose totals, model/topic/source breakdowns, costliest prompts, prompt visibility, source format, cache, context, and goal metadata.
- Setup diagnostics expose human-readable and JSON output for readiness checks and automation.
- Release checks include tests, typecheck, package dry-run, and CI.

## Non-Goals

- No heavy UI framework.
- No network pricing lookup.
- No modification of Claude Code or Codex CLI state.
- No remote telemetry or prompt upload.
- No mutation of source session logs.
