export const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 200000,
  "claude-sonnet-4-6": 200000,
  "claude-haiku-4-5-20251001": 200000,
  "claude-haiku-4-5": 200000,
  "gpt-5.5": 128000,
  "gpt-5": 128000,
  "gpt-5-mini": 128000,
  "codex-mini-latest": 200000
};

export function getContextWindow(model: string): number | null {
  return CONTEXT_WINDOWS[model] ?? null;
}

export function getContextUsagePct(inputTokens: number, contextWindow: number | null): number | null {
  if (contextWindow === null || contextWindow <= 0) {
    return null;
  }
  return inputTokens / contextWindow;
}
