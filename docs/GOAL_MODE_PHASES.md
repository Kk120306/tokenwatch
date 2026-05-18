# tokenwatch Goal-Mode Phases

## Phase 1: goal mode `scaffold`

Goal: establish the package, source layout, documentation, and bundled pricing.

Deliverables: `package.json`, `tsconfig.json`, `pricing.json`, `src/`, `docs/`, and README baseline.

Stop condition: package scripts and module boundaries exist.

Validation: `npm run typecheck` can be attempted after dependencies are installed.

## Phase 2: goal mode `parser-correctness`

Goal: implement strict parser behavior for Claude Code and Codex CLI logs.

Deliverables: Claude assistant usage parser, Codex cumulative delta parser, shared token interfaces.

Stop condition: parser tests prove assistant filtering, malformed-line tolerance, and Codex deltas.

Validation: parser unit tests pass.

## Phase 3: goal mode `active-session-detection`

Goal: watch both CLI log locations and select the newest modified session file.

Deliverables: `chokidar` watcher, mtime-based active file selection, per-file tail offsets.

Stop condition: watcher helpers choose the newest candidate and ignore missing files.

Validation: watcher unit tests pass.

## Phase 4: goal mode `cost-display`

Goal: render readable prompt rows and running totals with cost estimates.

Deliverables: pricing loader, cost estimator, high-cost yellow rows, dim total rows.

Stop condition: known model costs and unknown model fallbacks behave correctly.

Validation: pricing and display tests pass.

## Phase 5: goal mode `cli-packaging`

Goal: make `tokenwatch` usable through global npm installation.

Deliverables: executable CLI entry, npm `bin` mapping, README install instructions.

Stop condition: compiled `dist/index.js` runs and prints help.

Validation: `npm test` and `node dist/index.js --help` pass.
