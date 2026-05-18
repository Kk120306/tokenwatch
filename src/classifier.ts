import type { TopicConfidence, TopicRuleConfig } from "./types.js";

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

export function classifyPromptTopic(
  promptText: string,
  configuredRules: readonly TopicRuleConfig[] = []
): string {
  const configuredTopic = classifyWithConfiguredRules(promptText, configuredRules);
  if (configuredTopic) {
    return configuredTopic;
  }

  for (const [pattern, topic] of TOPIC_RULES) {
    if (pattern.test(promptText)) {
      return topic;
    }
  }
  return "general";
}

export function resolveTurnTopic(
  promptText: string | null,
  manualTopic: string | undefined,
  configuredRules: readonly TopicRuleConfig[] = []
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
    topic: classifyPromptTopic(promptText, configuredRules),
    topicConfidence: "auto"
  };
}

function classifyWithConfiguredRules(
  promptText: string,
  configuredRules: readonly TopicRuleConfig[]
): string | null {
  const normalizedPrompt = promptText.toLowerCase();
  for (const rule of configuredRules) {
    const topic = rule.topic.trim();
    if (!topic) {
      continue;
    }
    const matches = rule.keywords.some((keyword) => {
      const normalizedKeyword = keyword.trim().toLowerCase();
      return normalizedKeyword.length > 0 && normalizedPrompt.includes(normalizedKeyword);
    });
    if (matches) {
      return topic;
    }
  }
  return null;
}
