# tokenwatch Troubleshooting

This guide is for cases where tokenwatch starts but does not show the prompts,
costs, or reports you expected. tokenwatch is read-only for Claude Code and
Codex CLI storage, so every recovery step below is safe for source session logs.

## Start with diagnostics

Run the read-only checks first:

```sh
tokenwatch doctor
tokenwatch sessions
tokenwatch sessions --commands
```

Use `tokenwatch doctor --json` or `tokenwatch sessions --json` when you need a
scriptable report. The `sessions --commands` output prints copyable watch
commands for detected sessions.

## No prompts appear in the dashboard

Likely causes:

- No supported Claude Code or Codex CLI session has produced a token-usage row.
- The newest detected file is not the session you meant to watch.
- The dashboard is watching from the end of a file and is waiting for the next
  prompt.
- Prompt rows are hidden by model or topic filters.

Recovery steps:

1. Send one new prompt in Claude Code or Codex CLI while tokenwatch is open.
2. Run `tokenwatch sessions` and copy the explicit command for the session you
   want.
3. If you already know the file, run:

   ```sh
   tokenwatch --session /path/to/session.jsonl --session-source codex
   ```

   Use `--session-source claude` for Claude JSONL files.
4. In the TUI, press `f` or `t` and re-enable filtered models/topics, or remove
   `~/.tokenwatch/ui-state.json` to reset only tokenwatch view preferences.

## Codex says "waiting for session"

`codex -> waiting for session...` means tokenwatch found `state_5.sqlite`, but
recent Codex state does not point to a readable rollout JSONL yet.

Recovery steps:

- Keep tokenwatch open and send a Codex prompt; tokenwatch polls quickly while
  waiting and should adopt the rollout when it appears.
- Run `tokenwatch sessions` and choose an older readable rollout if the active
  thread is stale.
- If you have a known rollout path, bypass state detection:

  ```sh
  tokenwatch --session ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl --session-source codex
  ```

## Codex SQLite or log fallback shows usage-only rows

Codex fallback sources can expose token usage without paired prompt text.
tokenwatch still counts tokens, cost, cache, model, and goal metadata, but marks
prompt text as unavailable instead of guessing.

Prefer rollout JSONL when you need prompt text:

```sh
tokenwatch sessions
tokenwatch --session /path/to/rollout.jsonl --session-source codex
tokenwatch export --session /path/to/rollout.jsonl --session-source codex
```

## Ambiguous JSONL session source

A JSONL path outside normal `~/.claude` or `~/.codex` folders may not reveal its
source. Pass the source explicitly:

```sh
tokenwatch --session /tmp/session.jsonl --session-source claude
tokenwatch export --session /tmp/rollout.jsonl --session-source codex
```

## Exports say "no matching prompts found"

Export mode applies all filters together. Common causes are date bounds, topic
filters, model filters, or selecting a session with only zero-token rows.

Recovery steps:

1. Run the export without filters:

   ```sh
   tokenwatch export --session /path/to/session.jsonl --session-source codex --json --stdout
   ```

2. Add filters back one at a time: `--since`, `--until`, `--model`, `--topic`,
   or `--preset`.
3. Use `--all-sessions` when the prompt is in an older detected session.
4. Remember that `--preset daily` starts at the current UTC day and
   `--preset weekly` means the last seven days.

## Pricing looks stale or unknown models cost $0

Run:

```sh
tokenwatch pricing
tokenwatch pricing --json
```

Unknown models render with zero estimated cost until `pricing.json` contains a
matching key. Date-suffixed model IDs can resolve to a bundled base model when a
base key exists.

## Dashboard preferences seem stuck

The TUI stores only local, non-sensitive view preferences in
`~/.tokenwatch/ui-state.json`: selected view, filters, token display, prompt sort
mode, and stats focus. Delete that file to reset the dashboard without touching
budgets, config, exports, or source logs:

```sh
rm ~/.tokenwatch/ui-state.json
```

## Budget totals look wrong

Budget spend is tokenwatch-owned state in `~/.tokenwatch/spend.json`. Reset it
from the CLI when you want a fresh local budget period:

```sh
tokenwatch --reset-budget
```

This does not edit Claude Code or Codex CLI files.

## Privacy checklist before sharing output

- Do not share files from `~/.claude`, `~/.codex`, or `~/.tokenwatch` unless you
  have reviewed them.
- Use `--redact-prompts` for dashboards and exports that may leave your machine.
- Generated Markdown, CSV, and JSON reports can include prompt text unless
  redaction is enabled.
- Prefer `tokenwatch doctor --json` for support details because it reports paths,
  readiness, and warnings without prompt text.
