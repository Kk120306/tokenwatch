# tokenwatch Data Storage Notes

This note records where Claude Code and Codex CLI store prompt text and token
usage data, based on local inspection of this machine and the parser contracts
used by tokenwatch.

## Summary

Claude Code and Codex CLI do not use the same storage layout.

- Claude Code stores session data in JSONL files under `~/.claude/projects/`.
- Codex CLI stores structured session rollouts in JSONL files under
  `~/.codex/sessions/YYYY/MM/DD/`.
- Codex CLI also stores state and telemetry in SQLite databases under
  `~/.codex/`.

For Codex, the best single source for both prompt text and structured token
count events is the rollout JSONL file. SQLite has useful aggregate or telemetry
data, but prompt text and split token counts are not both available as clean
relational columns in one table.

## Claude Code

Observed path shape:

```text
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

Prompt text is stored in user JSONL entries. Token usage is stored in assistant
JSONL entries with `message.usage`.

Relevant JSONL shapes:

```json
{
  "type": "user",
  "message": {
    "content": "actual prompt text"
  }
}
```

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 1842,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 1200,
      "output_tokens": 347
    }
  }
}
```

tokenwatch maps Claude cached input as:

```text
cachedInputTokens = cache_creation_input_tokens + cache_read_input_tokens
```

The existing parser intentionally emits token turns from assistant entries only,
because those entries contain the usage payload.

## Codex CLI

Observed paths on this machine:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
~/.codex/history.jsonl
~/.codex/session_index.jsonl
~/.codex/state_5.sqlite
~/.codex/logs_2.sqlite
```

Observed SQLite files:

```text
/Users/kaikameyama/.codex/logs_2.sqlite
/Users/kaikameyama/.codex/state_5.sqlite
```

### Codex Rollout JSONL

Rollout JSONL files contain both prompt text and structured token count events.
This is the clearest place to correlate prompt text with Codex token usage.

Prompt text appears in user message entries:

```json
{
  "timestamp": "2026-05-18T02:02:50.458Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "actual prompt text"
      }
    ]
  }
}
```

Prompt text can also appear in event message entries:

```json
{
  "timestamp": "2026-05-18T02:02:50.458Z",
  "type": "event_msg",
  "payload": {
    "type": "user_message",
    "message": "actual prompt text",
    "images": [],
    "local_images": [],
    "text_elements": []
  }
}
```

Token usage appears in `token_count` event message entries:

```json
{
  "timestamp": "2026-05-18T02:03:03.534Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 27022,
        "cached_input_tokens": 5504,
        "output_tokens": 620,
        "reasoning_output_tokens": 516,
        "total_tokens": 27642
      },
      "last_token_usage": {
        "input_tokens": 27022,
        "cached_input_tokens": 5504,
        "output_tokens": 620,
        "reasoning_output_tokens": 516,
        "total_tokens": 27642
      },
      "model_context_window": 237500
    },
    "rate_limits": {
      "limit_id": "codex",
      "primary": {
        "used_percent": 2.0,
        "window_minutes": 300,
        "resets_at": 1779085098
      },
      "secondary": {
        "used_percent": 1.0,
        "window_minutes": 10080,
        "resets_at": 1779605742
      },
      "credits": null,
      "plan_type": "pro",
      "rate_limit_reached_type": null
    }
  }
}
```

`last_token_usage` is the useful per-turn shape when present. `total_token_usage`
is cumulative for the rollout.

### Codex State SQLite

`~/.codex/state_5.sqlite` contains thread metadata and aggregate token fields.
It does not expose `input_tokens` and `output_tokens` as separate relational
columns.

Relevant table shape:

```sql
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    sandbox_policy TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    git_sha TEXT,
    git_branch TEXT,
    git_origin_url TEXT,
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    memory_mode TEXT NOT NULL DEFAULT 'enabled',
    model TEXT,
    reasoning_effort TEXT,
    agent_path TEXT,
    created_at_ms INTEGER,
    updated_at_ms INTEGER,
    thread_source TEXT
);
```

Useful fields:

- `threads.rollout_path`: points to the canonical Codex rollout JSONL file.
- `threads.tokens_used`: aggregate token total for the thread.
- `threads.first_user_message`: first prompt text.

`thread_goals` also has aggregate goal token usage:

```sql
CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'budget_limited', 'complete')),
    token_budget INTEGER,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    time_used_seconds INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
```

### Codex Logs SQLite

`~/.codex/logs_2.sqlite` stores telemetry strings. It can contain token usage in
`feedback_log_body`, but the data is embedded in log text rather than clean
token columns.

Relevant table shape:

```sql
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    ts_nanos INTEGER NOT NULL,
    level TEXT NOT NULL,
    target TEXT NOT NULL,
    feedback_log_body TEXT,
    module_path TEXT,
    file TEXT,
    line INTEGER,
    thread_id TEXT,
    process_uuid TEXT,
    estimated_bytes INTEGER NOT NULL DEFAULT 0
);
```

Observed telemetry shape:

```text
codex.turn.token_usage.input_tokens=18655
codex.turn.token_usage.cached_input_tokens=16384
codex.turn.token_usage.non_cached_input_tokens=2271
codex.turn.token_usage.output_tokens=74
codex.turn.token_usage.reasoning_output_tokens=55
codex.turn.token_usage.total_tokens=18729
```

tokenwatch also supports `response.completed` payloads in `feedback_log_body`:

```text
Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":33372,"input_tokens_details":{"cached_tokens":32128},"output_tokens":102,"total_tokens":33474}},"sequence_number":82}
```

The parser maps Codex cached input as:

```text
cachedInputTokens = response.usage.input_tokens_details.cached_tokens
```

It also supports the legacy fallback:

```text
cachedInputTokens = response.usage.cached_input_tokens
```

## Implementation Notes

Current tokenwatch behavior:

- Claude Code: watches JSONL files and parses assistant `message.usage`.
- Codex CLI: prefers `logs_2.sqlite` when valid and readable, then falls back to
  JSONL/log files.
- Codex SQLite parsing currently targets `response.completed` payloads in
  `logs.feedback_log_body`.
- Codex rollout JSONL `token_count` events are the structured source found on
  this machine for `input_tokens`, `cached_input_tokens`, `output_tokens`, and
  `last_token_usage`.

For future Codex parser work, use `state_5.sqlite.threads.rollout_path` to map a
thread to its rollout JSONL file, then parse `response_item` or `user_message`
entries for prompt text and `token_count` entries for token usage.
