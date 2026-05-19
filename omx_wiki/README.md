# tokenwatch Project Wiki

This wiki captures operational knowledge that is useful during implementation,
triage, and support. It complements the public docs under `docs/` with compact
repo-local notes.

## Pages

- [Detection heuristics](detection.md) — source priority, prompt visibility, and
  fallback behavior.
- [Workflows and gotchas](workflows.md) — common CLI, TUI, export, and support
  flows.

## Maintenance rules

- Keep entries grounded in current code and tests.
- Link public user-facing fixes back to `README.md` or `docs/TROUBLESHOOTING.md`
  when the information should be visible outside the repo.
- Update this wiki when detection priority, parser contracts, export presets, or
  persisted state files change.
