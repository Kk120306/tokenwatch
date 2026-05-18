# tokenwatch PRD

## Summary

`tokenwatch` is a terminal companion for Claude Code and Codex CLI. It tails Claude Code's active JSONL log and polls Codex CLI's SQLite log database, then prints token usage per prompt, with input tokens, cached input tokens, output tokens, estimated cost, model, and running session totals.

## Goals

- Provide live per-prompt token visibility without modifying either AI CLI.
- Support Claude Code JSONL logs with direct per-turn usage.
- Support Codex CLI SQLite `response.completed` log rows with direct per-response usage.
- Keep the implementation small: TypeScript, Node 18+, `chokidar`, `better-sqlite3`, and `chalk`.

## Requirements

- Watch `~/.claude/projects/**/*.jsonl` for Claude Code.
- Poll `~/.codex/logs_2.sqlite` for new Codex CLI rows every 1-2 seconds.
- Pick the most recently modified Claude JSONL file as the active Claude session.
- Claude Code parser reads entries where `type` is `assistant` and `message.usage` exists.
- Codex parser reads `response.completed` rows and extracts `response.usage`.
- Cost estimation uses bundled `pricing.json`; unknown models return `$0`.
- Terminal output shows one line per prompt and a dim session total.
- Prompt rows with estimated cost over `$0.01` are highlighted yellow.

## Non-Goals

- No heavy UI framework.
- No network pricing lookup.
- No modification of Claude Code or Codex CLI state.
- No persistence beyond the live process.
