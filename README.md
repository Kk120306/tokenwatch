# tokenwatch

`tokenwatch` is a minimal TypeScript CLI that auto-detects Claude Code and Codex CLI storage, then prints per-prompt token usage in real time.

It tails the active Claude Code or Codex JSONL session file when JSONL storage is detected, and it polls Codex CLI's `logs_2.sqlite` database when SQLite storage is available.

## Install

```sh
npm install -g tokenwatch
```

For local development:

```sh
npm install
npm run build
npm install -g .
tokenwatch
```

## Usage

Run it in a terminal pane next to Claude Code or Codex CLI:

```sh
tokenwatch
```

Optional custom paths:

```sh
tokenwatch --claude-glob "$HOME/.claude/projects/**/*.jsonl" --codex-db "$HOME/.codex/logs_2.sqlite"
```

Environment overrides:

```sh
CODEX_HOME="$HOME/.codex" tokenwatch
CLAUDE_HOME="$HOME/.claude" tokenwatch
```

`CODEX_HOME` and `CLAUDE_HOME` are checked before the default `~/.codex` and `~/.claude` homes, so alternate CLI installations can be watched without custom flags.

## Output

```text
[#4] in: 1,842  cached: 1,200  out: 347  ~$0.0023  claude-sonnet-4-6
[#5] in: 3,100  cached: 2,800  out: 891  ~$0.0041  claude-sonnet-4-6
─────────────────────────────────────────────────────────────────────
session  in: 4,942  cached: 4,000  out: 1,238  ~$0.0064
```

Screenshot placeholder: add a terminal screenshot here after the first real run.

## Supported Logs

At startup, tokenwatch prints a detection summary for each CLI and keeps re-checking storage every 30 seconds so new session files can be picked up mid-run.

Detection order:

- Claude Code: `$CLAUDE_HOME/projects/**/*.jsonl`, `~/.claude/projects/**/*.jsonl`, direct `*.jsonl` files, then JSONL files under `.data/`. It reads assistant entries with `message.usage`.
- Codex CLI: `logs_2.sqlite`, session JSONL files under `sessions/`, direct `*.jsonl` files, then relevant files under `log/`. SQLite is preferred when present and readable; if it is locked, unreadable, or has an unexpected schema, tokenwatch warns and falls back to JSONL/log sources.

Malformed JSONL lines, empty files, storage rotations, and missing sources are ignored gracefully. If a CLI is not detected, the startup summary shows an actionable hint such as setting `CODEX_HOME` or starting a session.

## Pricing

Pricing is bundled in `pricing.json` and keyed by model name. Unknown models are still displayed, but their estimated cost falls back to `$0.0000`.

Bundled model keys:

- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`
- `gpt-5`
- `gpt-5-mini`
- `codex-mini-latest`

## Development

```sh
npm install
npm run typecheck
npm test
```
