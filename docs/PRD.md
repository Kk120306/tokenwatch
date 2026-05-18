# tokenwatch PRD

## Summary

`tokenwatch` is a terminal companion for Claude Code and Codex CLI. It tails the active session log and prints token usage per prompt, with input tokens, cached input tokens, output tokens, estimated cost, model, and running session totals.

## Goals

- Provide live per-prompt token visibility without modifying either AI CLI.
- Support Claude Code JSONL logs with direct per-turn usage.
- Support Codex CLI cumulative token events by diffing against the previous count.
- Keep the implementation small: TypeScript, Node 18+, `chokidar`, and `chalk`.

## Requirements

- Watch `~/.claude/projects/**/*.jsonl` and `~/.codex/*.jsonl`.
- Pick the most recently modified JSONL file across both sources as the active session.
- Claude Code parser reads entries where `type` is `assistant` and `message.usage` exists.
- Codex parser reads `token_count` events and computes non-negative deltas from cumulative counts.
- Cost estimation uses bundled `pricing.json`; unknown models return `$0`.
- Terminal output shows one line per prompt and a dim session total.
- Prompt rows with estimated cost over `$0.01` are highlighted yellow.

## Non-Goals

- No heavy UI framework.
- No network pricing lookup.
- No modification of Claude Code or Codex CLI state.
- No persistence beyond the live process.
