# tokenwatch Architecture

## Runtime Flow

1. `index.ts` parses CLI args, loads pricing, and starts the watcher.
2. `watcher.ts` watches Claude and Codex JSONL globs with `chokidar`.
3. The watcher selects the most recently modified session file as active.
4. New lines from the active file are routed to the Claude or Codex parser.
5. Parsed token turns are priced and formatted for terminal output.

## Modules

- `src/index.ts`: CLI entry point, args, signal handling, watcher wiring.
- `src/watcher.ts`: file watching, active session detection, tail offsets.
- `src/parsers/claude.ts`: Claude Code assistant usage extraction.
- `src/parsers/codex.ts`: Codex cumulative token event parsing and delta state.
- `src/pricing.ts`: bundled pricing load and cost estimation.
- `src/display.ts`: chalk formatting, high-cost highlighting, session totals.
- `src/types.ts`: shared strict TypeScript interfaces.

## Data Contracts

Claude turns come from `assistant` JSONL entries with `message.usage`. Codex turns come from `token_count`-style JSONL entries with cumulative token counts and optional `turn_context.model`.

All parser failures are soft failures: malformed or unrelated JSONL lines are ignored.
