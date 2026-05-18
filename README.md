# tokenwatch

```text
  ████████╗ ██████╗ ██╗  ██╗███████╗███╗  ██╗
     ██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗ ██║
     ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗██║
     ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚████║
     ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚███║
     ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚══╝
  ██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗
  ██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║
  ██║ █╗ ██║███████║   ██║   ██║     ███████║
  ██║███╗██║██╔══██║   ██║   ██║     ██╔══██║
  ╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║
   ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝
```

`tokenwatch` is a TypeScript terminal companion for Claude Code and Codex CLI. It reads local session storage, turns token usage into a live terminal dashboard, estimates cost from bundled pricing data, and can export Markdown or CSV reports for the latest session.

The project is designed for local-first usage: it does not call a pricing API, does not modify Claude Code or Codex CLI state, and keeps all persistent tokenwatch data under `~/.tokenwatch`.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Configuration](#configuration)
- [Supported Session Sources](#supported-session-sources)
- [Pricing and Cost Estimates](#pricing-and-cost-estimates)
- [Reports](#reports)
- [Data and Privacy](#data-and-privacy)
- [Development](#development)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [License](#license)

## Features

- Live terminal dashboard for Claude Code and Codex CLI token usage.
- Per-prompt input, cached input, output, reasoning token, model, topic, and cost visibility.
- Automatic local storage detection for Claude JSONL logs and Codex SQLite or JSONL session logs.
- Interactive Ink-based TUI with prompt, model, and stats views.
- Filters for models and topics.
- Prompt sorting by time, cache grade, or context-window usage.
- Cache efficiency grades and estimated cache savings.
- Context-window usage estimates for known models.
- Daily and weekly budget tracking with persisted local spend totals.
- Lightweight model recommendation summaries after enough prompts have been observed.
- Markdown and CSV exports for the most recent detected session.
- Graceful handling of missing sources, malformed lines, log rotations, and unknown model pricing.

## Requirements

- Node.js 18 or newer.
- npm.
- Claude Code and/or Codex CLI if you want live session detection.

The package is an ES module TypeScript CLI. Source is compiled to `dist/`, and the executable entry point is `dist/index.js`.

## Install

Install from npm when the package is published:

```sh
npm install -g tokenwatch
```

Install from source:

```sh
git clone https://github.com/Kk120306/tokenwatch.git
cd tokenwatch
npm install
npm run build
npm install -g .
```

Run the CLI:

```sh
tokenwatch
```

## Quick Start

Open `tokenwatch` in a terminal pane next to Claude Code or Codex CLI:

```sh
tokenwatch
```

Then send a prompt in your AI CLI. When tokenwatch detects a supported session source, usage appears in the dashboard.

Example terminal output shape:

```text
tokenwatch v0.1.0                                      LIVE

building      A  ~$0.0023  gpt-5.5
              [############################------------] 70% context

debugging     C  ~$0.0041  claude-sonnet-4-6
              [################------------------------] 39% context

[1] Prompts  [2] Models  [3] Stats  [r] Recs  [g] Cache sort  [w] Context sort  [f] Models  [t] Topics  [c] Tokens  [q] Quit
```

If no sessions are found, the onboarding screen shows the detected Claude Code and Codex CLI status plus a hint for the missing source.

## CLI Reference

```sh
tokenwatch [options]
tokenwatch export [export-options]
```

Main options:

| Option | Description |
| --- | --- |
| `--claude-glob <glob>` | Claude Code JSONL glob. Defaults to auto-detection from `$CLAUDE_HOME` or `~/.claude`. |
| `--codex-db <path>` | Codex SQLite database path. Defaults to auto-detection from `$CODEX_HOME` or `~/.codex`. |
| `--topic <name>` | Tag every parsed prompt in the session with a manual topic. |
| `--daily-budget <amount>` | Set a daily budget in USD for the current run. Overrides `~/.tokenwatch/config.json`. |
| `--weekly-budget <amount>` | Set a weekly budget in USD for the current run. Overrides `~/.tokenwatch/config.json`. |
| `--alert-at <pct>` | Budget alert threshold from `0.0` to `1.0`. Default is `0.8`. |
| `--reset-budget` | Reset persisted daily and weekly spend totals, then start watching. |
| `-h`, `--help` | Show CLI help. |

Export options:

| Option | Description |
| --- | --- |
| `export` | Write reports for the most recent detected session without launching the TUI. |
| `--md` | With `export`, write only the Markdown report unless `--csv` is also present. |
| `--csv` | With `export`, write only the CSV report unless `--md` is also present. |
| `--out <dir>` | With `export`, write reports to this directory. Default is `./tokenwatch-exports`. |

Examples:

```sh
tokenwatch --daily-budget 5 --weekly-budget 25 --alert-at 0.75
tokenwatch --topic documentation
tokenwatch --claude-glob "$HOME/.claude/projects/**/*.jsonl"
tokenwatch --codex-db "$HOME/.codex/logs_2.sqlite"
tokenwatch export
tokenwatch export --md --out ./reports
tokenwatch export --csv
```

## TUI Controls

| Key | Action |
| --- | --- |
| `1` | Open prompts view. |
| `2` | Open models view. |
| `3` | Open stats view. |
| `r` | Open recommendations in the stats view. |
| `g` | Toggle prompt sorting by cache grade. |
| `w` | Toggle prompt sorting by context-window usage. |
| `f` | Open model filter overlay. |
| `t` | Open topic filter overlay. |
| `c` | Toggle compact cost display and detailed token display. |
| Up and Down | Move selection in prompts view or filter overlays. |
| Enter | Expand a prompt row or apply a filter overlay. |
| Escape | Close a filter overlay without applying changes. |
| Space | Toggle the highlighted filter option inside a filter overlay. |
| `q` | Quit tokenwatch. |

## Configuration

Environment variables:

| Variable | Description |
| --- | --- |
| `CODEX_HOME` | Codex home directory to check before `~/.codex`. |
| `CLAUDE_HOME` | Claude Code home directory to check before `~/.claude`. |

Budget configuration can be persisted in `~/.tokenwatch/config.json`:

```json
{
  "dailyBudgetUsd": 5,
  "weeklyBudgetUsd": 25,
  "alertAt": 0.8
}
```

Persisted spend is stored in `~/.tokenwatch/spend.json`. Daily totals reset at local midnight. Weekly totals reset on Monday.

CLI budget flags override the config file for the current run.

## Supported Session Sources

tokenwatch checks both Claude Code and Codex CLI. It keeps re-detecting storage during a run so a newly created session can be picked up after startup.

Claude Code detection:

- `$CLAUDE_HOME/projects/**/*.jsonl`
- `~/.claude/projects/**/*.jsonl`
- Direct `*.jsonl` files under the Claude home directory.
- JSONL files under `.data/`.

Claude parsing behavior:

- Reads user prompt entries followed by assistant entries.
- Extracts usage from `message.usage`.
- Combines Claude cache creation and cache read tokens into cached input tokens.
- Ignores malformed lines and internal skill prompts.

Codex CLI detection:

- `$CODEX_HOME/state_5.sqlite`, when it points to an active rollout JSONL session.
- `~/.codex/state_5.sqlite`, when available.
- `$CODEX_HOME/logs_2.sqlite` or `~/.codex/logs_2.sqlite`.
- JSONL files under `sessions/`.
- Direct `*.jsonl` files under the Codex home directory.
- Relevant files under `log/`.

Codex parsing behavior:

- Reads `response.completed` usage payloads from SQLite logs.
- Reads rollout JSONL `token_count` and response usage events when JSONL storage is active.
- Includes reasoning tokens when present.
- Includes goal metadata when it is available in Codex state.
- Falls back to JSONL or log sources when SQLite is unreadable or has an unexpected schema.

## Pricing and Cost Estimates

Pricing is bundled in `pricing.json`. Costs are estimated locally from model, input tokens, cached input tokens, and output tokens.

Bundled model keys include:

- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`
- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5`
- `gpt-5-mini`
- `codex-mini-latest`

Unknown models still render in the dashboard. Their estimated cost falls back to `$0.0000` until pricing is added.

To update prices, edit `pricing.json`, add or adjust tests where behavior changes, then run:

```sh
npm test
```

## Reports

Use export mode to generate reports from the most recent detected session:

```sh
tokenwatch export
```

By default, export mode writes both Markdown and CSV files under `./tokenwatch-exports`.

Markdown reports include:

- Session date and duration.
- Total cost, prompt count, cache savings, and cache hit rate.
- Model summary.
- Topic summary.
- Prompt log with cost labels and prompt excerpts.
- Goal-mode summary when available.

CSV reports include row-level prompt data plus a session summary row for spreadsheet analysis.

## Data and Privacy

tokenwatch is local-first:

- It reads local Claude Code and Codex CLI logs.
- It reads bundled local pricing data.
- It writes only tokenwatch budget spend data and optional export files.
- It does not send prompts, token counts, paths, or pricing data over the network.
- It does not mutate Claude Code or Codex CLI session storage.

Avoid committing private session logs, generated reports that contain prompt text, or files from `~/.claude`, `~/.codex`, and `~/.tokenwatch`.

## Development

Install dependencies:

```sh
npm install
```

Build:

```sh
npm run build
```

Typecheck:

```sh
npm run typecheck
```

Run tests:

```sh
npm test
```

Link the local CLI:

```sh
npm install -g .
tokenwatch
```

Tests use Node's built-in `node:test` runner and import compiled files from `dist/`, so `npm test` builds before running the test suite.

## Project Structure

```text
src/
  index.ts              CLI entry point, argument parsing, TUI wiring
  watcher.ts            Claude and Codex storage detection, watching, and polling
  detect.ts             Storage discovery for Claude Code and Codex CLI
  parsers/
    claude.ts           Claude Code JSONL parser
    codex.ts            Codex SQLite, log, and JSONL parser helpers
  ui/
    App.tsx             Ink TUI
    selectors.ts        View filtering and statistics selectors
  pricing.ts            Local pricing table loading and cost estimation
  budget.ts             Daily and weekly spend persistence
  cache-score.ts        Cache hit-rate grading and savings estimates
  context-windows.ts    Known model context-window metadata
  recommender.ts        Topic/model recommendation summaries
  export/               Markdown and CSV report generation
test/                   Node test suite and fixtures
docs/                   Product notes, architecture notes, and test specs
pricing.json            Bundled model pricing
```

Generated build output lives in `dist/` and should not be edited by hand.

## Contributing

Contributions are welcome. This project is licensed under the MIT License, so issues, fixes, parser fixtures, documentation improvements, and package metadata updates can be contributed under that license.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

Good first contribution areas:

- Add pricing entries for new models.
- Add parser fixtures for new Claude Code or Codex CLI log shapes.
- Improve export formatting.
- Add tests for edge cases in detection, parsing, budgets, and recommendations.
- Improve documentation for common setups.

Before opening a pull request:

1. Keep diffs focused and reviewable.
2. Add or update tests for behavior changes.
3. Run `npm run typecheck`.
4. Run `npm test`.
5. Avoid committing private CLI session logs or generated reports with prompt text.

Pull requests should include:

- A short summary of the change.
- The reason the change is needed.
- Verification commands and results.
- Screenshots or terminal output when the TUI changes.
- Any known limitations or follow-up work.

## Troubleshooting

No sessions detected:

- Start Claude Code or Codex CLI and send a prompt.
- Check that `CLAUDE_HOME` or `CODEX_HOME` points to the expected home directory.
- Pass an explicit `--claude-glob` or `--codex-db` path.
- Confirm the current user can read the session files.

Costs show as `$0.0000`:

- The model may not exist in `pricing.json`.
- Add a pricing entry for the model and restart tokenwatch.

Budget data looks stale:

- Use `tokenwatch --reset-budget` to reset persisted daily and weekly totals.
- Inspect `~/.tokenwatch/spend.json` if you need to confirm what is being read.

Export says no active session was found:

- Send at least one prompt in Claude Code or Codex CLI first.
- Confirm the session source is in a supported location.
- Try `tokenwatch` without `export` to view the detection summary.

Terminal input does not work:

- Run tokenwatch in an interactive TTY.
- Some terminal panes and task runners do not support raw keyboard mode.

## Security

Please do not open public issues with private prompts, local session logs, tokens, or machine-specific paths. See [SECURITY.md](SECURITY.md) for the reporting policy.

## License

tokenwatch is released under the [MIT License](LICENSE).
