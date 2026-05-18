# tokenwatch

`tokenwatch` is a minimal TypeScript CLI that watches Claude Code and Codex CLI JSONL session logs and prints per-prompt token usage in real time.

It auto-detects the active AI CLI by watching both log locations and selecting the most recently modified JSONL session file.

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

Optional custom globs:

```sh
tokenwatch --claude-glob "$HOME/.claude/projects/**/*.jsonl" --codex-glob "$HOME/.codex/*.jsonl"
```

## Output

```text
[#4] in: 1,842  cached: 1,200  out: 347  ~$0.0023  claude-sonnet-4-6
[#5] in: 3,100  cached: 2,800  out: 891  ~$0.0041  claude-sonnet-4-6
─────────────────────────────────────────────────────────────────────
session  in: 4,942  cached: 4,000  out: 1,238  ~$0.0064
```

Screenshot placeholder: add a terminal screenshot here after the first real run.

## Supported Logs

- Claude Code: watches `~/.claude/projects/**/*.jsonl` and reads assistant entries with `message.usage`.
- Codex CLI: watches `~/.codex/*.jsonl`, reads cumulative `token_count` events, and diffs each event against the previous event for per-prompt usage.

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
