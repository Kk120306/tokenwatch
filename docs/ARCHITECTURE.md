# tokenwatch Architecture

## Runtime Flow

1. `index.ts` parses CLI args, loads pricing, and starts the watcher.
2. `watcher.ts` watches Claude JSONL globs with `chokidar` and polls Codex's SQLite database.
3. The Claude watcher selects the most recently modified JSONL session file as active.
4. New Claude lines and new Codex `logs` rows are routed to their parsers.
5. Parsed token turns are priced and formatted for terminal output.

## Modules

- `src/index.ts`: CLI entry point, args, signal handling, watcher wiring.
- `src/watcher.ts`: Claude file watching, active session detection, tail offsets, Codex SQLite polling.
- `src/parsers/claude.ts`: Claude Code assistant usage extraction.
- `src/parsers/codex.ts`: Codex rollout JSONL and `response.completed` SQLite log row parsing.
- `src/pricing.ts`: bundled pricing load and cost estimation.
- `src/display.ts`: chalk formatting, high-cost highlighting, session totals.
- `src/types.ts`: shared strict TypeScript interfaces.

## Data Contracts

Claude turns come from `assistant` JSONL entries with `message.usage`, paired with the preceding user prompt entry. Codex turns prefer rollout JSONL when `state_5.sqlite` exposes an active `threads.rollout_path`; in that path, user prompt entries are paired with `token_count` usage events. Codex SQLite fallback turns come from `~/.codex/logs_2.sqlite` `logs` rows where `feedback_log_body` contains a `Received message {"type":"response.completed", ...}` JSON payload. Token counts are extracted from `response.usage.input_tokens`, `response.usage.input_tokens_details.cached_tokens`, and `response.usage.output_tokens`; the model comes from `response.model`. Prompt text in Codex SQLite is best-effort and is attached only when a preceding user-message telemetry row is present.

All parser failures are soft failures: malformed or unrelated JSONL lines and SQLite log rows are ignored.

See `docs/DATA_STORAGE.md` for the observed Claude Code and Codex CLI storage
locations, including Codex rollout JSONL `token_count` events and SQLite schema
details.
