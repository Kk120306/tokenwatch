# Workflows and Gotchas

## First-run support flow

1. `tokenwatch doctor`
2. `tokenwatch sessions`
3. `tokenwatch sessions --commands`
4. Run the explicit watch command for the intended source.
5. If prompt text is sensitive, add `--redact-prompts` before sharing output.

## Export flow

- `tokenwatch export` writes Markdown and CSV for the newest detected session.
- `tokenwatch export --json --stdout` is best for automation.
- `--all-sessions` combines detected JSONL/log paths chronologically.
- `--preset daily`, `--preset weekly`, and topic presets such as
  `--preset debugging` prefill common filters.
- Explicit `--since` and `--topic` values override preset defaults.
- If an export is empty, remove filters first, then add them back one at a time.

## TUI state

- TUI preferences live in `~/.tokenwatch/ui-state.json`.
- Budget spend lives in `~/.tokenwatch/spend.json`.
- Config lives in `~/.tokenwatch/config.json`.
- Deleting UI state resets filters and view choices only; it does not affect
  budgets, config, source logs, or export files.

## Regression notes

- CLI surface changes should update `README.md`, `src/index.ts`, relevant
  subcommand help, `scripts/check-docs.mjs`, and e2e/help tests.
- Parser or detection changes should add tests with sanitized fixtures rather
  than private real session logs.
- Export behavior changes should be covered in `test/export.test.mjs` because
  tests import compiled `dist/` files.
- Watcher recovery changes should include targeted tests for truncation,
  deletion, or fallback transitions before broad refactors.
