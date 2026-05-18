# Contributing

Thanks for helping improve tokenwatch. This project is intended to stay small, local-first, and easy to verify.

## Before You Start

- Check existing issues and pull requests to avoid duplicate work.
- Keep changes focused and reviewable.
- Do not commit private Claude Code or Codex CLI logs.
- Do not commit generated reports that contain prompt text.
- Do not add dependencies unless they are needed and the tradeoff is clear.

## Development Setup

```sh
npm install
npm run build
npm test
```

For local CLI testing:

```sh
npm install -g .
tokenwatch
```

## Pull Request Checklist

Before opening a pull request, run:

```sh
npm run typecheck
npm test
```

Include the following in the pull request:

- What changed.
- Why the change is needed.
- How it was verified.
- Any known limitations or follow-up work.
- Terminal output or screenshots for TUI changes.

## Parser and Pricing Changes

Parser changes should include fixtures in `test/fixtures/` when possible. Keep fixtures synthetic or sanitized.

Pricing changes should update `pricing.json` and include tests for known-model behavior and unknown-model fallback behavior when relevant.

## Documentation Changes

Documentation should avoid local absolute paths, private prompt text, private usernames, and machine-specific details. Use paths such as `~/.codex/...` and `~/.claude/...` in examples.

