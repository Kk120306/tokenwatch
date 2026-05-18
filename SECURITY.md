# Security Policy

## Supported Versions

Security fixes target the latest version on the main branch until a release process is established.

## Reporting a Vulnerability

Do not open a public issue containing private prompts, local session logs, access tokens, API keys, or machine-specific paths.

Use GitHub private vulnerability reporting if it is enabled for the repository. If private reporting is not available, open a public issue with a minimal description that does not include sensitive data, and state that you have details to share privately.

Useful reports include:

- A short description of the issue.
- The affected version or commit.
- Reproduction steps using sanitized data.
- Whether private prompts, token counts, or local paths could be exposed.

## Scope

Security-sensitive areas include:

- Reading local Claude Code and Codex CLI storage.
- Exporting reports that may contain prompt text.
- Handling user-provided paths and globs.
- Persisting budget spend data under `~/.tokenwatch`.

