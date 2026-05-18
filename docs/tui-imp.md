# Rebuild tokenwatch into an interactive TUI with topic filtering, model breakdown, and human-readable formatting

## Context

Data sources are fully mapped. Do not guess any field names — use only what is documented below.

### Claude Code source

Path: `~/.claude/projects/<project-slug>/<session-id>.jsonl`

Prompt text: `type === "user"` → `message.content`

Token usage: `type === "assistant"` → `message.usage.input_tokens`, `message.usage.output_tokens`, `message.usage.cache_read_input_tokens + message.usage.cache_creation_input_tokens`

Model: `message.model`

### Codex source (primary)

Path: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

Use `~/.codex/state_5.sqlite` → `threads.rollout_path` to find the active session file

Prompt text: `type === "event_msg" + payload.type === "user_message"` → `payload.message`

Token usage: `type === "event_msg" + payload.type === "token_count"` → `payload.info.last_token_usage.input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_output_tokens`

Model: read from `state_5.sqlite` → `threads.model`

### Codex fallback

`logs_2.sqlite` → `feedback_log_body` containing `response.completed` JSON payloads

Parse `response.usage.input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`

## Step 1 — Extract prompt text from both sources

Update `src/parsers/claude.ts`:

When parsing a JSONL line, if `type === "user"` store the prompt text in a buffer

When the next `type === "assistant"` line arrives, attach the buffered prompt text to the `ParsedTurn`

Update `src/parsers/codex.ts`:

When parsing a rollout JSONL line, if `payload.type === "user_message"` store `payload.message` in a buffer

When the next `payload.type === "token_count"` arrives, attach the buffered prompt text to the `ParsedTurn`

Update `ParsedTurn` interface in `src/types.ts`:

```typescript
interface ParsedTurn {
  id: number
  timestamp: Date
  model: string
  source: 'claude' | 'codex'
  promptText: string | null
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  topic: string | null        // auto-classified or manual
  topicConfidence: 'auto' | 'manual' | null
}
```

## Step 2 — Auto topic classification

Create `src/classifier.ts`:

Takes `promptText: string` and returns a topic string

Use simple keyword matching first, no external API needed:

```typescript
const TOPIC_RULES: [RegExp, string][] = [
  [/\b(fix|bug|error|crash|exception|broken|not working)\b/i, 'debugging'],
  [/\b(refactor|cleanup|reorganize|restructure|rename)\b/i, 'refactoring'],
  [/\b(test|spec|jest|vitest|coverage|assert)\b/i, 'testing'],
  [/\b(explain|what is|how does|why|understand)\b/i, 'learning'],
  [/\b(write|create|implement|add|build|generate)\b/i, 'building'],
  [/\b(review|check|look at|audit|analyse)\b/i, 'review'],
  [/\b(document|readme|comment|jsdoc)\b/i, 'documentation'],
  [/\b(deploy|ci|cd|pipeline|docker|build)\b/i, 'devops'],
]
```

If no rule matches → topic is `'general'`

Also support `--topic <name>` CLI flag to manually override for the whole session

## Step 3 — Switch display to ink TUI

Replace current stdout output with a full-screen ink app.

Install:

```bash
npm install ink react
npm install --save-dev @types/react
```

Create `src/ui/App.tsx` as the root component with three views toggled by keypress.

App state:

```typescript
interface AppState {
  turns: ParsedTurn[]
  activeView: 'prompts' | 'models' | 'stats'
  filterModels: string[]
  filterTopics: string[]
  expandedTurnId: number | null
  showTokens: boolean   // toggle between cost view and raw token view
  isLive: boolean       // pulsing indicator
}
```

## Step 4 — Prompts view (key: 1, default)

Each turn renders as:

```text
#164  gpt-5.5  debugging                    moderate  ~$0.008
      ████████████░░░░░░░░░░░░░░░░░░░░░░░
```

Expanded (press enter):

```text
#164  gpt-5.5  debugging                    moderate  ~$0.008
      ████████████░░░░░░░░░░░░░░░░░░░░░░░
      "fix the auth middleware not passing headers"
      46.2k in   45.4k cached   1.6k out   516 reasoning
```

Cost labels:

```text
< $0.001 → dim trivial
$0.001–$0.01 → white cheap
$0.01–$0.05 → yellow moderate
$0.05–$0.20 → orange expensive
> $0.20 → red very expensive
```

Cost bar: width proportional to most expensive turn this session.

## Step 5 — Models view (key: 2)

```text
  claude-haiku-4-5     153 prompts    ~$0.82    avg ~$0.005/prompt
  ████████████████████████████████████████████

  gpt-5.5              11 prompts     ~$0.34    avg ~$0.031/prompt
  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

  Recommendation: use claude-haiku for routine prompts (6x cheaper/prompt)
```

## Step 6 — Stats view (key: 3)

```text
  Session Summary
  ─────────────────────────────────────────
  Total cost              ~$1.16
  Total prompts           164
  Duration                1h 23m
  Avg cost/prompt         ~$0.007
  Most expensive prompt   #154  ~$0.041  (refactoring)
  Cache hit rate          67%
  Cache savings           ~$2.34 saved
  Most expensive topic    refactoring  ~$0.031/prompt avg
  Cheapest topic          learning     ~$0.003/prompt avg
  ─────────────────────────────────────────
  Top topics
  debugging       48 prompts   ~$0.38
  building        41 prompts   ~$0.29
  refactoring     22 prompts   ~$0.31
```

## Step 7 — Topic filter (key: t)

```text
  Filter by topic:
  [x] debugging
  [x] building
  [ ] refactoring
  [x] learning
  [x] general
  ↑↓ move   space toggle   enter apply   esc cancel
```

## Step 8 — Model filter (key: f)

```text
  Filter by model:
  [x] claude-haiku-4-5
  [x] gpt-5.5
  [ ] claude-sonnet-4-6
  ↑↓ move   space toggle   enter apply   esc cancel
```

## Step 9 — Keyboard shortcuts bar

Always visible at bottom:

```text
[1] Prompts  [2] Models  [3] Stats  [f] Models  [t] Topics  [c] Toggle tokens  [q] Quit
```

## Step 10 — Onboarding state

When `turns.length === 0`:

```text
  tokenwatch is ready
  ─────────────────────────────────────────
  ✓  Claude Code   ~/.claude/projects/...   jsonl
  ✓  Codex CLI     ~/.codex/sessions/...    jsonl

  Send a prompt in your AI CLI to see usage appear here.
```

## Step 11 — Live indicator

Header shows `● LIVE` that toggles dim/bright every 1 second using `setInterval` + ink state update. Goes dim gray if no new turn in last 30 seconds.

## Success criteria

Non-technical user understands the display without explanation

Topic appears on every prompt that has text

`--topic <name>` flag overrides auto-classification for whole session

Topic filter and model filter both work independently and together

Stats view shows cache savings and per-topic cost breakdown

Model comparison shows clear recommendation

All existing parser and detector logic unchanged

Tool updates within 2 seconds of each new prompt
