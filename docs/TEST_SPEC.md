# tokenwatch Test Spec

## Parser Tests

- Claude parser emits a turn for `assistant` entries with `message.usage`.
- Claude parser ignores user entries, unrelated assistant entries, blank lines, and malformed JSON.
- Codex parser emits a turn for SQLite `logs.feedback_log_body` values containing `response.completed` usage.
- Codex SQLite parser attaches preceding `user_message` telemetry to the next `response.completed` turn when present.
- Codex parser extracts `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, and `response.model`.
- Codex rollout parsing can derive per-turn usage from cumulative `total_token_usage` deltas when `last_token_usage` is absent and a previous total exists.
- Codex parser ignores malformed, unrelated, or usage-free SQLite log rows.
- Topic classification applies configured keyword rules before built-in rules, while manual `--topic` override remains highest priority.
- Sanitized real-world fixtures cover Claude Code JSONL prompt pairing, Codex rollout JSONL usage snapshots, and Codex SQLite feedback-log prompt attribution.

## Configuration Tests

- `~/.tokenwatch/config.json` loads budget values, alert threshold, prompt redaction preference, and valid configured topic rules.
- Invalid configured topic rules are ignored without breaking default configuration loading.
- First-run init creates, preserves, and updates tokenwatch config without touching Claude Code or Codex CLI storage.

## Pricing Tests

- Known model cost equals input, cached input, and output pricing per million tokens.
- Unknown model cost returns `0`.
- Bundled pricing includes verified current OpenAI Codex and Claude model rates.
- Pricing freshness reports verification date, source URLs, and stale status.

## Watcher Tests

- Active session detection chooses the candidate with the newest `mtimeMs`.
- Missing or non-file paths are ignored by path inspection.
- Codex SQLite polling reads only rows newer than the last seen `rowid`, advances past unrelated rows, and preserves pending prompt text across polling intervals.
- Explicit Codex rollout session paths are accepted as JSONL storage.

## Session Listing Tests

- Session listing renders detected source paths, prompt visibility hints, and watch commands.
- Session JSON output exposes detected sources, sessions, and warnings for scripts.
- Session selection infers Claude and Codex paths when unambiguous and requires `--session-source` for ambiguous JSONL paths.
- Doctor diagnostics report readiness, degraded discovery warnings, missing sources, config errors, prompt visibility, pricing freshness, suggested watch commands, and equivalent JSON diagnostics.

## Display Tests

- Prompt rows include index, input, cached input, output, cost, and model.
- Session total rows are dimmed by chalk.
- Prompt rows over `$0.01` are highlighted yellow.
- TUI footer status reports visible prompt count, filtered cost, sort mode, filter counts, and token/cost display state.
- TUI shortcuts switch to compact labels for narrow terminals.

## CLI Smoke Tests

- Build succeeds with `tsc`.
- `node dist/index.js --help` prints usage.
- `node dist/index.js init --non-interactive` creates or preserves tokenwatch config defaults.
- `node dist/index.js doctor` and `node dist/index.js doctor --json` print local setup diagnostics without mutating source logs.
- `npm test` passes.

## Export Tests

- Markdown and CSV reports keep prompt-level rows, grouped totals, and summary rows.
- JSON reports expose stable `schemaVersion: 1` summaries, model/topic groups, per-prompt token, cache, context, prompt-visibility, source-format, and goal fields.
- Export mode can target an explicit `--session` path instead of always selecting the newest detected session.
- Export redaction replaces prompt text with `[redacted]` while preserving topic classification and token totals.
