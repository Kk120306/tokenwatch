# Repository Guidelines

## Project Structure & Module Organization

`tokenwatch` is a TypeScript CLI package. Source files live in `src/`, with the CLI entry point at `src/index.ts`. Domain types are in `src/types.ts`, terminal rendering in `src/display.ts`, pricing logic in `src/pricing.ts`, file watching in `src/watcher.ts`, and log parsers under `src/parsers/`. Tests live in `test/`, with JSONL fixtures in `test/fixtures/`. Generated build output goes to `dist/` and should not be edited by hand. Product and design notes are in `docs/`.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run build` compiles TypeScript into `dist/`.
- `npm run typecheck` runs `tsc` without emitting files.
- `npm test` builds first, then runs `node --test test/*.test.mjs`.
- `npm install -g .` links the local CLI so you can run `tokenwatch`.

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules and explicit `.js` extensions in relative imports, matching the existing `NodeNext` setup. Keep indentation at two spaces. Prefer small, named functions and typed interfaces for shared shapes. Use `camelCase` for variables/functions, `PascalCase` for interfaces and classes, and descriptive parser filenames such as `src/parsers/codex.ts`.

## Testing Guidelines

Tests use Node’s built-in `node:test` module with `node:assert/strict`. Add or update tests in `test/*.test.mjs` when parser, pricing, display, or watcher behavior changes. Put reusable sample logs in `test/fixtures/`. Because tests import from `dist/`, run `npm run build` or `npm test` before relying on results.

## Commit & Pull Request Guidelines

Current history is minimal (`init`), so use concise, intent-focused commit messages going forward. For agent-authored commits, follow the repository Lore protocol: start with why the change was made, then include useful trailers such as `Tested: npm test` and `Not-tested:` when relevant. Pull requests should include a short summary, verification commands run, linked issue if any, and terminal output or screenshots for CLI display changes.

## Security & Configuration Tips

Do not commit private Claude or Codex session logs. Keep pricing changes in `pricing.json`, and verify unknown models still render safely with zero-cost fallback behavior.
