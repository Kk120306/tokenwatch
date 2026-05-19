# Detection Heuristics

## Source priority

| Source | Preferred path | Prompt visibility | Notes |
| --- | --- | --- | --- |
| Claude Code JSONL | `$CLAUDE_HOME/projects/**/*.jsonl` or `~/.claude/projects/**/*.jsonl` | Prompt text plus usage when user and assistant entries pair | Active file is selected by latest mtime. |
| Codex state to rollout JSONL | `$CODEX_HOME/state_5.sqlite -> threads.rollout_path` or `~/.codex/state_5.sqlite` | Prompt text plus usage when user and `token_count` events pair | Scans recent active threads and skips unreadable rollout paths. |
| Codex logs SQLite | `$CODEX_HOME/logs_2.sqlite` or `~/.codex/logs_2.sqlite` | Usage is reliable; prompt text is best-effort from preceding telemetry | Used when no readable active rollout is available. |
| Codex sessions JSONL | `$CODEX_HOME/sessions/**/*.jsonl` or `~/.codex/sessions/**/*.jsonl` | Prompt text plus usage when rollout events pair | Fallback when state does not identify a current rollout. |
| Codex log files | `$CODEX_HOME/log/` or `~/.codex/log/` | Structured events only when present in log text | Lowest-fidelity fallback. |

## Runtime behavior

- The watcher announces the adopted Codex source: rollout JSONL, SQLite, log
  fallback, or waiting for session.
- Richer Codex sources outrank poorer sources, so a live rollout should replace
  SQLite/log fallbacks when it becomes readable.
- JSONL watchers start from the file tail on first launch and read all content
  when switching to a newly detected active file.
- Truncation restarts the JSONL reader at the new file size and logs a recovery
  message instead of replaying stale offsets.
- Deleted active files clear offsets and parsers so tokenwatch can wait for a
  replacement file.

## Explicit selection

Use explicit session selection when auto-detection chooses the wrong source:

```sh
tokenwatch --session /path/to/session.jsonl --session-source claude
tokenwatch --session /path/to/rollout.jsonl --session-source codex
tokenwatch export --session /path/to/logs_2.sqlite --session-source codex
```

Ambiguous JSONL paths outside normal Claude/Codex folders must include
`--session-source`.
