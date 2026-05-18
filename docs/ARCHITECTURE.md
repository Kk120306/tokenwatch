# tokenwatch Architecture

## Runtime Flow

1. `index.ts` routes subcommands, loads config/pricing, applies privacy and budget settings, and starts the watcher for the live dashboard.
2. `detect.ts` and `sessions.ts` discover supported local Claude Code and Codex CLI storage and produce copyable watch/export commands.
3. `watcher.ts` watches Claude JSONL globs with `chokidar`, follows Codex rollout JSONL, and polls Codex SQLite/log fallbacks.
4. New Claude lines, Codex rollout events, and Codex SQLite rows are routed to source-specific parsers.
5. `turns.ts` enriches parsed usage with price, topic, cache, context, prompt visibility, and goal metadata.
6. Ink renders live prompt/model/stats views, while export mode renders Markdown, CSV, or JSON reports from the same parsed turn shape.

## Modules

- `src/index.ts`: CLI entry point, args, signal handling, watcher wiring.
- `src/init.ts`: first-run config creation and setup summary.
- `src/doctor.ts`: readiness diagnostics and scriptable JSON diagnostics.
- `src/sessions.ts`: detected session listing, source inference, shell-safe watch/export commands.
- `src/watcher.ts`: Claude file watching, active session detection, tail offsets, Codex rollout following, Codex SQLite polling.
- `src/parsers/claude.ts`: Claude Code assistant usage extraction.
- `src/parsers/codex.ts`: Codex rollout JSONL, cumulative token snapshot deltas, and `response.completed` SQLite/log row parsing.
- `src/pricing.ts`: bundled pricing load and cost estimation.
- `src/budget.ts`: persisted daily, weekly, and monthly spend records plus projections.
- `src/config.ts`: tokenwatch config loading, validation, normalization, and saving.
- `src/export/`: Markdown, CSV, JSON, and shared report summary formatting.
- `src/ui/`: Ink dashboard views, selectors, filters, budget/status rendering, and recommendations.
- `src/privacy.ts`: prompt redaction for dashboard state and exports.
- `src/types.ts`: shared strict TypeScript interfaces.

## Data Contracts

Claude turns come from `assistant` JSONL entries with `message.usage`, paired with the preceding user prompt entry. Codex turns prefer rollout JSONL when `state_5.sqlite` exposes an active `threads.rollout_path`; in that path, user prompt entries are paired with `token_count` usage events. When a rollout emits only cumulative `total_token_usage`, tokenwatch computes a per-prompt delta after a prior total exists. Codex SQLite fallback turns come from `~/.codex/logs_2.sqlite` `logs` rows where `feedback_log_body` contains a `Received message {"type":"response.completed", ...}` JSON payload. Token counts are extracted from `response.usage.input_tokens`, `response.usage.input_tokens_details.cached_tokens`, and `response.usage.output_tokens`; the model comes from `response.model`. Prompt text in Codex SQLite is best-effort and is attached only when a preceding user-message telemetry row is present.

All parser failures are soft failures: malformed or unrelated JSONL lines and SQLite log rows are ignored.

tokenwatch writes only its own state: `~/.tokenwatch/config.json`, `~/.tokenwatch/spend.json`, and user-requested export files. It does not write to Claude Code or Codex CLI storage.

See `docs/DATA_STORAGE.md` for the observed Claude Code and Codex CLI storage
locations, including Codex rollout JSONL `token_count` events and SQLite schema
details.
