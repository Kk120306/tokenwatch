import type { ParsedTurn } from "./types.js";

export const REDACTED_PROMPT_TEXT = "[redacted]";

export function redactParsedTurnPrompt(turn: ParsedTurn): ParsedTurn {
  return turn.promptText
    ? { ...turn, promptText: REDACTED_PROMPT_TEXT }
    : turn;
}
