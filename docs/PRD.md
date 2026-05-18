# tokenwatch PRD

## Summary

`tokenwatch` is a terminal companion for Claude Code and Codex CLI. It tails Claude Code's active JSONL log, follows Codex CLI rollout JSONL when available, and polls Codex CLI's SQLite log database as a fallback. It prints token usage per visible prompt, with input tokens, cached input tokens, output tokens, estimated cost, model, and running session totals. When a fallback source exposes usage but not prompt text, tokenwatch still counts the turn and marks prompt text unavailable rather than guessing.

## Goals

- Provide live per-prompt token visibility without modifying either AI CLI.
- Support Claude Code JSONL logs with direct per-turn usage.
- Support Codex CLI rollout JSONL with prompt text and `token_count` usage.
- Support Codex CLI SQLite `response.completed` log rows with direct per-response usage and best-effort prompt attribution from preceding user-message telemetry.
- Keep the implementation small: TypeScript, Node 18+, `chokidar`, `better-sqlite3`, and `chalk`.

## Requirements

- Watch `~/.claude/projects/**/*.jsonl` for Claude Code.
- Poll `~/.codex/logs_2.sqlite` for new Codex CLI rows every 1-2 seconds.
- Pick the most recently modified Claude JSONL file as the active Claude session.
- Claude Code parser reads entries where `type` is `assistant` and `message.usage` exists.
- Codex rollout parser pairs user prompt entries with `token_count` usage.
- Codex SQLite parser reads `response.completed` rows, extracts `response.usage`, and attaches prompt text only when ordered user-message telemetry is present.
- Cost estimation uses bundled `pricing.json`; unknown models return `$0`.
- Terminal output shows one line per prompt and a dim session total.
- Prompt rows with estimated cost over `$0.01` are highlighted yellow.

## Non-Goals

- No heavy UI framework.
- No network pricing lookup.
- No modification of Claude Code or Codex CLI state.
- No persistence beyond the live process.
