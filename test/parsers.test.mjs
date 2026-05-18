import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scoreCacheEfficiency } from "../dist/cache-score.js";
import { classifyPromptTopic, resolveTurnTopic } from "../dist/classifier.js";
import { getContextUsagePct, getContextWindow } from "../dist/context-windows.js";
import { createClaudeParser } from "../dist/parsers/claude.js";
import { createCodexJsonlParser, createCodexSqliteParser, parseCodexFeedbackLogBody, parseCodexJsonlLine, parseCodexLogRow } from "../dist/parsers/codex.js";
import { createParsedTurn } from "../dist/turns.js";

test("Claude parser extracts assistant message usage", async () => {
  const lines = (await readFile("test/fixtures/claude.jsonl", "utf8")).split("\n");
  const parser = createClaudeParser();
  const turns = lines.map((line) => parser.parseLine(line)).filter(Boolean);

  assert.equal(turns.length, 1);
  assert.equal(turns[0].source, "claude");
  assert.equal(turns[0].model, "claude-sonnet-4-6");
  assert.equal(turns[0].promptText, "hello");
  assert.ok(turns[0].timestamp instanceof Date);
  assert.deepEqual(turns[0].usage, {
    inputTokens: 1842,
    cachedInputTokens: 1200,
    outputTokens: 347,
    reasoningTokens: 0
  });
});

test("Claude parser accepts real text prompts and ignores internal user entries", () => {
  const parser = createClaudeParser();

  assert.equal(parser.parseLine(JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "text", text: "whats this project about" }]
    }
  })), null);

  const realTurn = parser.parseLine(JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 300, output_tokens: 30 }
    }
  }));

  assert.equal(realTurn.promptText, "whats this project about");
  assert.deepEqual(realTurn.usage, {
    inputTokens: 300,
    cachedInputTokens: 0,
    outputTokens: 30,
    reasoningTokens: 0
  });

  assert.equal(parser.parseLine(JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", content: "internal tool output" }]
    }
  })), null);
  assert.equal(parser.parseLine(JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 999, output_tokens: 99 }
    }
  })), null);

  assert.equal(parser.parseLine(JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "text", text: "<skill>\ninternal skill instructions\n</skill>" }]
    }
  })), null);
  assert.equal(parser.parseLine(JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 888, output_tokens: 88 }
    }
  })), null);
});

test("Codex parser extracts response.completed usage from SQLite log rows", async () => {
  const body = await readFile("test/fixtures/codex-response-completed.txt", "utf8");

  const turn = parseCodexLogRow({ rowid: 4997629, feedback_log_body: body });

  assert.equal(turn.source, "codex");
  assert.equal(turn.model, "gpt-5.5");
  assert.equal(turn.promptText, null);
  assert.ok(turn.timestamp instanceof Date);
  assert.deepEqual(turn.usage, {
    inputTokens: 33372,
    cachedInputTokens: 32128,
    outputTokens: 102,
    reasoningTokens: 0
  });
});

test("Codex SQLite parser attaches preceding user prompt text to response usage", () => {
  const parser = createCodexSqliteParser();

  assert.equal(parser.parseRow({
    rowid: 1,
    feedback_log_body: 'Received message {"type":"event_msg","payload":{"type":"user_message","message":"fix the sqlite prompt attribution path"}}'
  }), null);

  const turn = parser.parseRow({
    rowid: 2,
    feedback_log_body: 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":20},"output_tokens":30,"reasoning_output_tokens":5}}}'
  });

  assert.equal(turn.source, "codex");
  assert.equal(turn.promptText, "fix the sqlite prompt attribution path");
  assert.deepEqual(turn.usage, {
    inputTokens: 120,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 5
  });

  const nextTurn = parser.parseRow({
    rowid: 3,
    feedback_log_body: 'Received message {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":10,"output_tokens":2}}}'
  });
  assert.equal(nextTurn.promptText, null);
});

test("Codex parser supports legacy cached_input_tokens shape in response usage", () => {
  const body = JSON.stringify({
    type: "response.completed",
    response: {
      model: "gpt-5",
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 250,
        output_tokens: 50
      }
    }
  });

  const turn = parseCodexFeedbackLogBody(body);

  assert.equal(turn.source, "codex");
  assert.equal(turn.model, "gpt-5");
  assert.equal(turn.promptText, null);
  assert.deepEqual(turn.usage, {
    inputTokens: 1000,
    cachedInputTokens: 250,
    outputTokens: 50,
    reasoningTokens: 0
  });
});


test("Codex JSONL parser extracts rollout prompt text and token_count usage", () => {
  const parser = createCodexJsonlParser({ model: "gpt-5.5" });
  assert.equal(parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "fix the auth middleware not passing headers"
    }
  })), null);

  const turn = parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 128000,
        last_token_usage: {
          input_tokens: 46200,
          cached_input_tokens: 45400,
          output_tokens: 1600,
          reasoning_output_tokens: 516
        }
      }
    }
  }));

  assert.equal(turn.source, "codex");
  assert.equal(turn.model, "gpt-5.5");
  assert.equal(turn.promptText, "fix the auth middleware not passing headers");
  assert.equal(turn.timestamp.toISOString(), "2026-05-18T00:00:00.000Z");
  assert.equal(turn.contextWindow, 128000);
  assert.deepEqual(turn.usage, {
    inputTokens: 46200,
    cachedInputTokens: 45400,
    outputTokens: 1600,
    reasoningTokens: 516
  });
});

test("Codex JSONL parser aggregates rollout token_count events for one visible prompt", () => {
  const parser = createCodexJsonlParser({ model: "gpt-5.5" });
  assert.equal(parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "explain the project architecture to me"
    }
  })), null);

  const first = parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:01.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 20,
          reasoning_output_tokens: 5
        }
      }
    }
  }));

  assert.equal(first.promptText, "explain the project architecture to me");
  assert.equal(first.timestamp.toISOString(), "2026-05-18T00:00:00.000Z");
  assert.match(first.updateKey, /^codex-rollout:\d+:1$/);
  assert.deepEqual(first.usage, {
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 20,
    reasoningTokens: 5
  });

  assert.equal(parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      role: "tool",
      message: "tool emitted a synthetic prompt"
    }
  })), null);

  const second = parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:03.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 250,
          cached_input_tokens: 200,
          output_tokens: 80,
          reasoning_output_tokens: 30
        }
      }
    }
  }));

  assert.equal(second.updateKey, first.updateKey);
  assert.equal(second.contextInputTokens, 250);
  assert.deepEqual(second.usage, {
    inputTokens: 350,
    cachedInputTokens: 240,
    outputTokens: 100,
    reasoningTokens: 35
  });

  assert.equal(parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:01:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "build a new prompt filter"
    }
  })), null);

  const nextPrompt = parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:01:01.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 10,
          output_tokens: 2
        }
      }
    }
  }));

  assert.notEqual(nextPrompt.updateKey, first.updateKey);
  assert.deepEqual(nextPrompt.usage, {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 2,
    reasoningTokens: 0
  });
});

test("Codex JSONL parser ignores internal and non-user rollout messages", () => {
  const parser = createCodexJsonlParser({ model: "gpt-5.5" });
  const ignoredPrompts = [
    { message: "short" },
    { message: "tool emitted a synthetic prompt", role: "tool" },
    { message: "agent emitted a synthetic prompt", source: "agent" },
    { message: "<|internal agent marker|> do not list this" },
    {
      message: [
        "You are OMX Explore, a low-cost read-only repository exploration harness.",
        "Operate strictly in read-only mode."
      ].join("\n")
    },
    { message: "{\"cmd\":\"rg token_count src\"}" }
  ];

  for (const prompt of ignoredPrompts) {
    assert.equal(parser.parseLine(JSON.stringify({
      timestamp: "2026-05-18T00:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        ...prompt
      }
    })), null);
    assert.equal(parser.parseLine(JSON.stringify({
      timestamp: "2026-05-18T00:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            reasoning_output_tokens: 5
          }
        }
      }
    })), null);
  }

  assert.equal(parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          output_tokens: 0,
          reasoning_output_tokens: 12
        }
      }
    }
  })), null);

  assert.equal(parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "fix the prompt list filtering"
    }
  })), null);

  const turn = parser.parseLine(JSON.stringify({
    timestamp: "2026-05-18T00:00:01.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 200,
          output_tokens: 40,
          reasoning_output_tokens: 8
        }
      }
    }
  }));

  assert.equal(turn.source, "codex");
  assert.equal(turn.promptText, "fix the prompt list filtering");
  assert.deepEqual(turn.usage, {
    inputTokens: 200,
    cachedInputTokens: 0,
    outputTokens: 40,
    reasoningTokens: 8
  });
});

test("Codex JSONL parser still extracts nested response.completed usage", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-18T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "response.completed",
      response: {
        model: "gpt-5.5",
        usage: {
          input_tokens: 42,
          input_tokens_details: { cached_tokens: 12 },
          output_tokens: 7
        }
      }
    }
  });

  const turn = parseCodexJsonlLine(line);
  assert.equal(turn.source, "codex");
  assert.equal(turn.model, "gpt-5.5");
  assert.equal(turn.promptText, null);
  assert.deepEqual(turn.usage, {
    inputTokens: 42,
    cachedInputTokens: 12,
    outputTokens: 7,
    reasoningTokens: 0
  });
  assert.equal(parseCodexJsonlLine("not json"), null);
});

test("topic classification and manual override populate ParsedTurn topics", () => {
  assert.equal(classifyPromptTopic("please fix the failing auth bug"), "debugging");
  assert.equal(classifyPromptTopic("explain how token caching works"), "learning");
  assert.equal(classifyPromptTopic("fix the stripe invoice retry", [
    { topic: "billing", keywords: ["stripe", "invoice"] }
  ]), "billing");
  assert.deepEqual(resolveTurnTopic("audit the signup funnel", undefined, [
    { topic: "growth", keywords: ["signup funnel"] }
  ]), {
    topic: "growth",
    topicConfidence: "auto"
  });
  assert.deepEqual(resolveTurnTopic(null, undefined), {
    topic: null,
    topicConfidence: null
  });

  const parsed = createParsedTurn({
    updateKey: "codex-rollout:1:1",
    source: "codex",
    model: "gpt-5.5",
    timestamp: new Date("2026-05-18T00:00:00.000Z"),
    timestampIso: "2026-05-18T00:00:00.000Z",
    promptText: "add a prompt table",
    usage: {
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50
    }
  }, 7, {}, "research");

  assert.equal(parsed.topic, "research");
  assert.equal(parsed.topicConfidence, "manual");
  assert.equal(parsed.updateKey, "codex-rollout:1:1");
  assert.equal(parsed.cacheGrade, "F");
  assert.equal(parsed.cacheHitRate, 0.1);
  assert.equal(parsed.cacheSavingsUsd, 0);
  assert.equal(parsed.contextWindow, 237500);
  assert.equal(parsed.contextUsagePct, 1000 / 237500);

  const configured = createParsedTurn({
    source: "codex",
    model: "gpt-5.5",
    timestamp: new Date("2026-05-18T00:01:00.000Z"),
    timestampIso: "2026-05-18T00:01:00.000Z",
    promptText: "add stripe invoice retry handling",
    usage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0
    }
  }, 8, {}, undefined, [{ topic: "billing", keywords: ["stripe", "invoice"] }]);
  assert.equal(configured.topic, "billing");
  assert.equal(configured.topicConfidence, "auto");
});

test("context window lookup covers known models and unknown fallback", () => {
  assert.equal(getContextWindow("claude-sonnet-4-6"), 200000);
  assert.equal(getContextWindow("gpt-5.5"), 237500);
  assert.equal(getContextWindow("unknown-model"), null);
});

test("context usage percentage is capped to the model window", () => {
  assert.equal(getContextUsagePct(64_000, 128_000), 0.5);
  assert.equal(getContextUsagePct(256_000, 128_000), 1);
  assert.equal(getContextUsagePct(1_000, null), null);
});

test("ParsedTurn context usage uses latest context snapshot when available", () => {
  const parsed = createParsedTurn({
    source: "codex",
    model: "gpt-5.5",
    timestamp: new Date("2026-05-18T00:00:00.000Z"),
    timestampIso: "2026-05-18T00:00:00.000Z",
    promptText: "explain the architecture",
    contextInputTokens: 250,
    contextWindow: 1000,
    usage: {
      inputTokens: 350,
      cachedInputTokens: 240,
      outputTokens: 100,
      reasoningTokens: 35
    }
  }, 8, {});

  assert.equal(parsed.inputTokens, 350);
  assert.equal(parsed.contextUsagePct, 0.25);
});

test("cache efficiency scoring grades thresholds and savings", () => {
  const pricing = {
    "gpt-5.5": {
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 30
    }
  };

  const score = scoreCacheEfficiency({
    model: "gpt-5.5",
    inputTokens: 1000,
    cachedTokens: 800
  }, pricing);
  assert.equal(score.cacheGrade, "A");
  assert.equal(score.cacheHitRate, 0.8);
  assert.ok(Math.abs(score.cacheSavingsUsd - 0.0036) < 0.000001);
  assert.equal(scoreCacheEfficiency({ model: "gpt-5.5", inputTokens: 1000, cachedTokens: 600 }, pricing).cacheGrade, "B");
  assert.equal(scoreCacheEfficiency({ model: "gpt-5.5", inputTokens: 1000, cachedTokens: 400 }, pricing).cacheGrade, "C");
  assert.equal(scoreCacheEfficiency({ model: "gpt-5.5", inputTokens: 1000, cachedTokens: 200 }, pricing).cacheGrade, "D");
  assert.equal(scoreCacheEfficiency({ model: "gpt-5.5", inputTokens: 1000, cachedTokens: 199 }, pricing).cacheGrade, "F");
  assert.equal(scoreCacheEfficiency({ model: "unknown", inputTokens: 1000, cachedTokens: 900 }, pricing).cacheSavingsUsd, 0);
});

test("Codex parser ignores malformed and unrelated SQLite log rows", () => {
  assert.equal(parseCodexFeedbackLogBody(""), null);
  assert.equal(parseCodexFeedbackLogBody("not json"), null);
  assert.equal(parseCodexFeedbackLogBody("Received message not json"), null);
  assert.equal(
    parseCodexFeedbackLogBody(JSON.stringify({ type: "response.output_item.done" })),
    null
  );
  assert.equal(
    parseCodexLogRow({ rowid: 1, feedback_log_body: "Received message {\"type\":\"response.completed\"}" }),
    null
  );
});
