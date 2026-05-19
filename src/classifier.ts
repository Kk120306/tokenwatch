import type { TopicConfidence, TopicRuleConfig } from "./types.js";

interface WeightedTopicRule {
  pattern: RegExp;
  topic: string;
  weight: number;
}

const TOPIC_TIE_BREAK = [
  "debugging",
  "devops",
  "testing",
  "refactoring",
  "documentation",
  "review",
  "learning",
  "building"
] as const;

const WEIGHTED_TOPIC_RULES: readonly WeightedTopicRule[] = [
  { pattern: /\b(fix|debug|bug|error|crash|exception|broken|regression|not working)\b/i, topic: "debugging", weight: 4 },
  { pattern: /\b(failing|failed|failure|flaky)\b/i, topic: "debugging", weight: 2 },

  { pattern: /\b(ci|cd|pipeline|deploy|deployment|release|docker|container|kubernetes|helm|terraform|workflow|github actions)\b/i, topic: "devops", weight: 4 },
  { pattern: /\b(build pipeline|docker build|release workflow|deployment workflow)\b/i, topic: "devops", weight: 4 },
  { pattern: /\b(compile|bundle|build)\b(?=.*\b(ci|pipeline|docker|release|deploy)\b)/i, topic: "devops", weight: 2 },

  { pattern: /\b(test|tests|spec|specs|jest|vitest|coverage|assert|snapshot)\b/i, topic: "testing", weight: 4 },
  { pattern: /\b(unit|integration|e2e|end-to-end)\b/i, topic: "testing", weight: 2 },

  { pattern: /\b(refactor|cleanup|clean up|reorganize|restructure|rename|simplify|deduplicate)\b/i, topic: "refactoring", weight: 4 },

  { pattern: /\b(document|documentation|docs|readme|comment|comments|jsdoc|changelog)\b/i, topic: "documentation", weight: 4 },

  { pattern: /\b(review|check|look at|audit|analyze|analyse|inspect|critique)\b/i, topic: "review", weight: 4 },
  { pattern: /\b(security|performance|accessibility)\s+(review|audit|check)\b/i, topic: "review", weight: 2 },

  { pattern: /\b(explain|what is|how does|why|understand|teach|walk me through)\b/i, topic: "learning", weight: 4 },

  { pattern: /\b(write|create|implement|add|build|generate|scaffold)\b/i, topic: "building", weight: 2 },
  { pattern: /\b(feature|page|component|endpoint|api|command|view|dashboard|screen)\b/i, topic: "building", weight: 2 }
];

export const TOPIC_RULES: [RegExp, string][] = WEIGHTED_TOPIC_RULES.map((rule) => [
  rule.pattern,
  rule.topic
]);

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

  return classifyWithWeightedRules(promptText);
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

function classifyWithWeightedRules(promptText: string): string {
  const scores = new Map<string, number>();
  for (const rule of WEIGHTED_TOPIC_RULES) {
    if (!rule.pattern.test(promptText)) {
      continue;
    }
    scores.set(rule.topic, (scores.get(rule.topic) ?? 0) + rule.weight);
  }

  if (scores.size === 0) {
    return "general";
  }

  return [...scores.entries()].sort(([leftTopic, leftScore], [rightTopic, rightScore]) => {
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return topicRank(leftTopic) - topicRank(rightTopic);
  })[0]?.[0] ?? "general";
}

function topicRank(topic: string): number {
  const index = TOPIC_TIE_BREAK.indexOf(topic as (typeof TOPIC_TIE_BREAK)[number]);
  return index === -1 ? TOPIC_TIE_BREAK.length : index;
}
