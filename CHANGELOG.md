# Changelog

## Unreleased

- Added first-run `tokenwatch init` / `tokenwatch setup` configuration.
- Added JSON output for `tokenwatch doctor` and `tokenwatch sessions`.
- Added prompt-visibility and source-format metadata to exports.
- Added shell-safe active watch commands via `tokenwatch sessions --commands`.
- Added source breakdowns, cost-share percentages, and costliest prompt highlights to generated reports.
- Added monthly budget tracking alongside daily and weekly budgets.
- Improved Codex rollout parsing for cumulative `total_token_usage` snapshots.
- Added CI, prepublish checks, and package dry-run release gates.

## 0.1.0

- Initial local-first tokenwatch CLI.
- Claude Code JSONL and Codex CLI JSONL/SQLite detection.
- Live TUI, prompt-level token/cost rows, budgets, exports, redaction, pricing freshness, and setup diagnostics.
