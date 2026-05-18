import type { TopicConfidence } from "./types.js";

export const TOPIC_RULES: [RegExp, string][] = [
  [/\b(fix|bug|error|crash|exception|broken|not working)\b/i, "debugging"],
  [/\b(refactor|cleanup|reorganize|restructure|rename)\b/i, "refactoring"],
  [/\b(test|spec|jest|vitest|coverage|assert)\b/i, "testing"],
  [/\b(explain|what is|how does|why|understand)\b/i, "learning"],
  [/\b(write|create|implement|add|build|generate)\b/i, "building"],
  [/\b(review|check|look at|audit|analyse)\b/i, "review"],
  [/\b(document|readme|comment|jsdoc)\b/i, "documentation"],
  [/\b(deploy|ci|cd|pipeline|docker|build)\b/i, "devops"]
];

export interface TopicResult {
  topic: string | null;
  topicConfidence: TopicConfidence | null;
}

export function classifyPromptTopic(promptText: string): string {
  for (const [pattern, topic] of TOPIC_RULES) {
    if (pattern.test(promptText)) {
      return topic;
    }
  }
  return "general";
}

export function resolveTurnTopic(
  promptText: string | null,
  manualTopic: string | undefined
): TopicResult {
  const normalizedManualTopic = manualTopic?.trim();
  if (normalizedManualTopic) {
    return {
      topic: normalizedManualTopic,
      topicConfidence: "manual"
    };
  }

  if (!promptText) {
    return {
      topic: null,
      topicConfidence: null
    };
  }

  return {
    topic: classifyPromptTopic(promptText),
    topicConfidence: "auto"
  };
}
