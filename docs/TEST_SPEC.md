# tokenwatch Test Spec

## Parser Tests

- Claude parser emits a turn for `assistant` entries with `message.usage`.
- Claude parser ignores user entries, unrelated assistant entries, blank lines, and malformed JSON.
- Codex parser emits the first cumulative `token_count` event as the first prompt count.
- Codex parser diffs subsequent cumulative events against the previous event.
- Codex parser ignores unrelated history or metadata JSONL lines.

## Pricing Tests

- Known model cost equals input, cached input, and output pricing per million tokens.
- Unknown model cost returns `0`.

## Watcher Tests

- Active session detection chooses the candidate with the newest `mtimeMs`.
- Missing or non-file paths are ignored by path inspection.

## Display Tests

- Prompt rows include index, input, cached input, output, cost, and model.
- Session total rows are dimmed by chalk.
- Prompt rows over `$0.01` are highlighted yellow.

## CLI Smoke Tests

- Build succeeds with `tsc`.
- `node dist/index.js --help` prints usage.
- `npm test` passes.
