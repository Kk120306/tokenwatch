# tokenwatch — Feature Phase Plan

## Overview

Four self-contained phases, each designed to be run as a single Codex goal mode session. Each phase builds on the previous but does not break existing functionality. Run them in order. Commit and push after each phase

---

## Phase 1 — Cache Efficiency Score

**Goal: Help users understand how well they are reusing context, in plain language**

### What it does

Every prompt gets a cache efficiency score from A to F based on how much of the input was served from cache versus freshly processed. The score is displayed as a letter grade with a one-line plain-English explanation — no token counts, no percentages unless the user asks.

### Grade scale

| Grade | Cache hit rate | Plain English label |
|-------|---------------|---------------------|
| A | 80–100% | Excellent — almost all context reused |
| B | 60–79% | Good — most context came from cache |
| C | 40–59% | Fair — about half was reused |
| D | 20–39% | Poor — mostly fresh context each time |
| F | 0–19% | None — no caching benefit |

### UI changes

- Add grade badge next to cost label on each prompt card: `#5  gpt-5.5  debugging  B  moderate  ~$0.018`
- Expand view shows: `"Cache: B — most context reused, saving ~$0.04 this prompt"`
- Stats view adds a new section:

```
Cache Efficiency
────────────────────────────────────────
Overall grade        B
Average hit rate     64%
Total saved          ~$2.34 across 164 prompts
Best session topic   learning   A  (91% hit rate)
Worst topic          debugging  D  (28% hit rate)

Tip: Your debugging prompts start fresh often. Try continuing
     existing sessions instead of starting new ones.
```

- Tips are plain English, actionable, and rotate based on actual data patterns

### Data sources

- Claude Code: `cache_read_input_tokens + cache_creation_input_tokens` vs `input_tokens`
- Codex: `cached_input_tokens` vs `input_tokens` from `last_token_usage`

### Formula

```
hit_rate = cached_input_tokens / input_tokens
savings_usd = cached_input_tokens * (standard_rate - cache_rate)
```

### Goal mode prompt

```
Goal: Add cache efficiency scoring to tokenwatch

Context:
Each ParsedTurn already has inputTokens and cachedTokens. Add a cache
efficiency score (A–F letter grade) to every turn and surface it in the
UI with plain English explanations. Non-technical users should understand
what the grade means without knowing what a token is.

Step 1 — Add to src/types.ts:
  cacheGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  cacheHitRate: number        // 0.0 to 1.0
  cacheSavingsUsd: number     // dollars saved vs no caching

Step 2 — Add src/cache-score.ts:
  Export function scoreCacheEfficiency(turn: ParsedTurn): CacheScore
  Grade thresholds: A=80%+, B=60%+, C=40%+, D=20%+, F=below 20%
  Savings = cachedTokens * (inputPricePerToken - cacheReadPricePerToken)
  Use pricing.json for rates, fallback to 0 if model not found

Step 3 — Call scoreCacheEfficiency in both parsers after building ParsedTurn

Step 4 — Update prompts view card:
  Show grade badge between model and cost label
  Grade colors: A=green, B=cyan, C=yellow, D=orange, F=red
  Expanded view shows plain English: "Cache: B — most context reused,
  saving ~$0.04 this prompt"

Step 5 — Update stats view with cache section:
  Overall grade (average across session)
  Total savings in dollars
  Best and worst topic by cache hit rate
  One actionable plain-English tip based on the data:
    - F/D overall → "Try continuing sessions instead of starting fresh"
    - A/B overall → "Great cache usage — keep sessions going"
    - Best topic much better than worst → "Your [topic] prompts cache
      poorly — try adding more context to earlier prompts"

Step 6 — Add [g] keyboard shortcut to sort prompts by cache grade
  ascending (worst first) so user can find inefficient prompts quickly

Success criteria:
- Every prompt card shows a letter grade
- Grade is correct: A when cached > 80% of input, F when < 20%
- Savings amount is non-zero for prompts with cache hits
- Stats tip is different for low vs high cache efficiency sessions
- Existing display, filters, and keyboard shortcuts all still work
```

---

## Phase 2 — Lightweight Model Recommendation

**Goal: Tell users which model to use for which task, based on their own usage data**

### What it does

After at least 5 prompts, tokenwatch analyzes cost-per-prompt by topic and model, then surfaces a recommendation panel. It compares what you actually used against what would have been cheaper, and gives a simple verdict.

### Design principles

- No external API calls — all logic runs locally on the session data already captured
- Recommendations only appear after enough data exists to be meaningful (5+ prompts)
- Plain English, not model names where possible ("the fast cheap model" vs "claude-haiku-4-5-20251001")
- Never recommend a model the user has not already used — only compare observed models

### UI changes

New panel in Stats view:

```
Model Recommendations
────────────────────────────────────────
Based on your last 164 prompts:

  debugging    currently: gpt-5.5  ($0.031/prompt)
               cheaper option: claude-haiku ($0.005/prompt)
               potential saving: ~$1.43 this session  ↓ 84%

  learning     currently: gpt-5.5  ($0.031/prompt)
               cheaper option: claude-haiku ($0.005/prompt)
               potential saving: ~$0.67 this session  ↓ 84%

  building     you already use the best value model ✓

Overall: switching routine prompts to claude-haiku could save
         ~$2.10/session (~81% reduction)
```

- Recommendations only compare models the user has actually used
- "Best value" = lowest cost per prompt for that topic
- Savings is calculated as (current_model_cost - cheaper_model_cost) * prompt_count
- Shows percentage reduction not just dollar amount

### Algorithm (lightweight, no ML)

```
for each topic:
  group turns by model
  compute avg_cost_per_prompt per model
  find min_cost_model
  if current_most_used_model != min_cost_model:
    recommend switch with savings estimate
```

### Goal mode prompt

```
Goal: Add lightweight model recommendation to tokenwatch stats view

Context:
tokenwatch already tracks per-turn model, topic, and cost. Use this
data to recommend cheaper models per topic. No external API calls,
no ML — pure arithmetic on observed turns.

Only recommend models the user has already used in this session.
Only show recommendations when 5+ turns exist.
Use plain English model nicknames where possible.

Step 1 — Add src/recommender.ts:
  Input: ParsedTurn[]
  Output: Recommendation[]

  interface Recommendation {
    topic: string
    currentModel: string           // most-used model for this topic
    currentAvgCost: number
    cheaperModel: string | null    // cheapest observed model for this topic
    cheaperAvgCost: number | null
    potentialSavingUsd: number
    potentialSavingPct: number
    alreadyOptimal: boolean
  }

  Algorithm:
    Group turns by topic
    For each topic, group by model and compute avg cost/prompt
    Find most-used model (by prompt count) and cheapest model
    If they differ, create a recommendation
    Sort recommendations by potentialSavingUsd descending

Step 2 — Add model nickname map in src/recommender.ts:
  'claude-haiku-4-5-20251001' → 'claude-haiku (fast, cheap)'
  'claude-sonnet-4-6' → 'claude-sonnet (balanced)'
  'claude-opus-4-6' → 'claude-opus (most capable)'
  'gpt-5.5' → 'gpt-5.5'
  'gpt-5' → 'gpt-5'
  Fallback: use raw model name

Step 3 — Add Recommendations panel to stats view:
  Show after existing stats, only when turns.length >= 5
  Show "Not enough data yet — send 5+ prompts" when below threshold
  Each recommendation shows topic, current model, cheaper option,
  savings in dollars and percentage
  "already optimal" topics show a ✓ with no savings figure
  Final line shows total potential session saving across all topics

Step 4 — Add [r] keyboard shortcut to jump directly to stats view
  and scroll to the recommendations panel

Success criteria:
- No recommendations shown with fewer than 5 prompts
- Recommendations only reference models seen in current session
- Savings calculation is correct: (current_avg - cheaper_avg) * prompt_count
- "Already optimal" shows correctly when cheapest = most used
- Total saving line sums correctly across all topics
- Existing stats content still renders above recommendations
```

---

## Phase 3 — Context Window Usage

**Goal: Show users how much of the model's memory they are filling with each prompt**

### What it does

Each prompt shows what percentage of the model's context window was used. This is already partly available from Codex's `model_context_window` field. For Claude it requires a static lookup table.

### Why it matters for users

Context window usage is the single best predictor of cost — the more context you fill, the more every token costs and the slower responses get. Showing it as a visual fill meter makes this immediately intuitive.

### UI changes

Prompt card gains a context bar:

```
#164  gpt-5.5  debugging  B  expensive  ~$0.041
      ████████████████████████░░░░░░░░░░  68% of context window
      46.2k in   45.4k cached   1.6k out
```

Warning states:
- Under 50% → dim gray bar, no label
- 50–75% → yellow bar, `68% of context window`
- 75–90% → orange bar, `82% of context — getting full`
- Over 90% → red bar, `94% of context — almost full, consider starting fresh`

Stats view adds:

```
Context Window
────────────────────────────────────────
Average usage        54% of context
Highest prompt       #154  94%  ⚠ nearly full
Prompts over 75%     3 prompts
Prompts over 90%     1 prompt

Tip: Prompt #154 was nearly at the context limit. Starting a
     new session for large tasks keeps responses faster and cheaper.
```

### Data sources

- Codex: `payload.info.model_context_window` already in rollout JSONL
- Claude: static lookup table by model name

### Context window lookup table

```typescript
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gpt-5.5': 128000,
  'gpt-5': 128000,
  'gpt-5-mini': 128000,
  'codex-mini-latest': 200000,
}
```

### Goal mode prompt

```
Goal: Add context window usage display to tokenwatch

Context:
Each ParsedTurn has inputTokens. Codex rollout JSONL includes
model_context_window in token_count events. Claude requires a
static lookup. Show context usage as a visual fill bar on each
prompt card with plain-English warnings when approaching limits.

Step 1 — Add to src/types.ts:
  contextWindow: number | null    // max tokens for this model
  contextUsagePct: number | null  // inputTokens / contextWindow

Step 2 — Add src/context-windows.ts:
  Export CONTEXT_WINDOWS lookup table (see above)
  Export function getContextWindow(model: string): number | null
  Fallback: return null if model not in table

Step 3 — Update Codex parser:
  When parsing token_count event, read payload.info.model_context_window
  Store as contextWindow on ParsedTurn
  Compute contextUsagePct = inputTokens / contextWindow

Step 4 — Update Claude parser:
  After building ParsedTurn, call getContextWindow(turn.model)
  Compute contextUsagePct if window found, else null

Step 5 — Update prompt card in prompts view:
  Add context bar row below the cost bar, only when contextUsagePct != null
  Bar width = contextUsagePct * full bar width
  Under 50%: dim gray bar, no text label
  50-75%: yellow bar + "X% of context window"
  75-90%: orange bar + "X% of context — getting full"
  Over 90%: red bar + "X% of context — almost full, consider starting fresh"

Step 6 — Add context window section to stats view:
  Average context usage across session
  Highest single prompt by context usage
  Count of prompts over 75% and over 90%
  Plain-English tip if any prompt exceeded 75%

Step 7 — Add [w] keyboard shortcut to sort prompts by context
  usage descending (highest first)

Success criteria:
- Context bar appears on prompt cards for all known models
- Bar is hidden when contextUsagePct is null (unknown model)
- Color changes correctly at 50%, 75%, 90% thresholds
- Warning text is plain English, not percentages by default
- Stats section shows correct counts and highest prompt
- Codex uses live model_context_window value, Claude uses static table
```

---

## Phase 4 — Daily and Weekly Budget Tracking

**Goal: Let users set spending limits and see progress toward them in real time**

### What it does

Users set a daily and/or weekly budget via CLI flags or a config file. tokenwatch shows a budget progress bar in the header and alerts when approaching or exceeding limits. Budget resets automatically at midnight (daily) and Monday midnight (weekly).

### UI changes

Header gains budget bar:

```
tokenwatch                    today ~$1.16 / $5.00  ████████░░░░░░░░  23%  ● LIVE
```

Over 80% of budget:
```
tokenwatch                    today ~$4.20 / $5.00  ████████████████  84%  ⚠ 84%  ● LIVE
```

Over 100%:
```
tokenwatch                    today ~$5.80 / $5.00  ████████████████  116%  ✗ OVER  ● LIVE
```

Stats view adds budget section:

```
Budget
────────────────────────────────────────
Daily budget         $5.00
Spent today          ~$1.16  (23%)
Remaining today      ~$3.84
Reset in             6h 42m

Weekly budget        $25.00
Spent this week      ~$8.43  (34%)
Remaining this week  ~$16.57
Reset in             3d 6h

Projected daily spend    ~$3.20  (on track)
Projected weekly spend   ~$22.40  (on track)
```

Projection is based on spend rate so far this session extrapolated to end of day/week.

### Configuration

CLI flags (highest priority):
```bash
tokenwatch --daily-budget 5.00 --weekly-budget 25.00
```

Config file `~/.tokenwatch/config.json` (persistent):
```json
{
  "dailyBudgetUsd": 5.00,
  "weeklyBudgetUsd": 25.00,
  "alertAt": 0.8
}
```

No budget set → header shows total cost only, no bar.

### Persistence

Budget spend must persist across tokenwatch restarts. Store daily and weekly totals in `~/.tokenwatch/spend.json`:

```json
{
  "dailyTotal": 1.16,
  "dailyDate": "2026-05-18",
  "weeklyTotal": 8.43,
  "weeklyStartDate": "2026-05-13"
}
```

On startup, load this file. If `dailyDate` is not today, reset `dailyTotal` to 0. If `weeklyStartDate` is more than 7 days ago, reset `weeklyTotal` to 0.

### Goal mode prompt

```
Goal: Add daily and weekly budget tracking to tokenwatch

Context:
Each ParsedTurn has costUsd. Add persistent budget tracking with
a progress bar in the header and a budget section in stats view.
Budgets are optional — if not set, show nothing extra in the header.

Step 1 — Create ~/.tokenwatch/config.json schema in src/config.ts:
  interface TokenwatchConfig {
    dailyBudgetUsd: number | null
    weeklyBudgetUsd: number | null
    alertAt: number   // default 0.8 (80%)
  }
  Export loadConfig(): TokenwatchConfig
  Read from ~/.tokenwatch/config.json, fallback to defaults if missing

Step 2 — Add CLI flags to src/index.ts:
  --daily-budget <amount>    sets dailyBudgetUsd, overrides config file
  --weekly-budget <amount>   sets weeklyBudgetUsd, overrides config file
  --alert-at <pct>           sets alertAt (0.0–1.0), overrides config file

Step 3 — Create src/budget.ts:
  interface SpendRecord {
    dailyTotal: number
    dailyDate: string          // YYYY-MM-DD
    weeklyTotal: number
    weeklyStartDate: string    // YYYY-MM-DD of most recent Monday
  }

  Export loadSpend(): SpendRecord
    Read ~/.tokenwatch/spend.json
    If dailyDate != today, reset dailyTotal to 0
    If weeklyStartDate is > 7 days ago, reset weeklyTotal to 0
    Return record

  Export saveSpend(record: SpendRecord): void
    Write to ~/.tokenwatch/spend.json atomically

  Export addSpend(costUsd: number): SpendRecord
    Load, add to dailyTotal and weeklyTotal, save, return updated record

  Export getProjectedDailySpend(dailyTotal: number, sessionStart: Date): number
    Extrapolate current spend rate to end of day

  Call addSpend on every new ParsedTurn

Step 4 — Update header in App.tsx:
  If no budget set: show "session ~$X.XX" as before
  If budget set:
    Show "today ~$X.XX / $Y.YY  [bar]  ZZ%"
    Bar color: green under 60%, yellow 60-80%, orange 80-100%, red over 100%
    Over 80%: add ⚠ with percentage
    Over 100%: add ✗ OVER in red

Step 5 — Add Budget section to stats view:
  Only show when at least one budget is configured
  Daily: spent, remaining, reset time (time until midnight)
  Weekly: spent, remaining, reset time (time until next Monday midnight)
  Projected spend for day and week based on current rate
  "On track" / "At risk" / "Over budget" verdict per period

Step 6 — Create ~/.tokenwatch/ directory on first run if it doesn't exist

Step 7 — Add --reset-budget flag that zeroes spend.json (for testing)

Success criteria:
- Header shows budget bar only when a budget is configured
- Bar color changes correctly at 60%, 80%, 100%
- Daily total persists across tokenwatch restarts on same day
- Daily total resets to 0 when date changes
- Weekly total resets on Monday
- Projected spend is reasonable: (current_total / elapsed_hours) * 24
- Stats budget section only visible when budget is set
- No budget set = zero UI changes from current behavior
```

---

## Running Order

| Phase | Feature | Estimated complexity | Run after |
|-------|---------|---------------------|-----------|
| 1 | Cache efficiency score | Low | Current working build |
| 2 | Model recommendation | Low-Medium | Phase 1 |
| 3 | Context window usage | Medium | Phase 2 |
| 4 | Budget tracking | Medium | Phase 3 |

Each phase goal mode prompt is fully self-contained. Paste it directly into Codex goal mode with no modifications needed.
