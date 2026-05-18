# tokenwatch Test Spec

## Parser Tests

- Claude parser emits a turn for `assistant` entries with `message.usage`.
- Claude parser ignores user entries, unrelated assistant entries, blank lines, and malformed JSON.
- Codex parser emits a turn for SQLite `logs.feedback_log_body` values containing `response.completed` usage.
- Codex SQLite parser attaches preceding `user_message` telemetry to the next `response.completed` turn when present.
- Codex parser extracts `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, and `response.model`.
- Codex parser ignores malformed, unrelated, or usage-free SQLite log rows.
- Topic classification applies configured keyword rules before built-in rules, while manual `--topic` override remains highest priority.

## Configuration Tests

- `~/.tokenwatch/config.json` loads budget values, alert threshold, and valid configured topic rules.
- Invalid configured topic rules are ignored without breaking default configuration loading.

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
- Session selection infers Claude and Codex paths when unambiguous and requires `--session-source` for ambiguous JSONL paths.

## Display Tests

- Prompt rows include index, input, cached input, output, cost, and model.
- Session total rows are dimmed by chalk.
- Prompt rows over `$0.01` are highlighted yellow.

## CLI Smoke Tests

- Build succeeds with `tsc`.
- `node dist/index.js --help` prints usage.
- `npm test` passes.

## Export Tests

- Markdown and CSV reports keep prompt-level rows, grouped totals, and summary rows.
- JSON reports expose stable `schemaVersion: 1` summaries, model/topic groups, per-prompt token, cache, context, and goal fields.
- Export mode can target an explicit `--session` path instead of always selecting the newest detected session.
