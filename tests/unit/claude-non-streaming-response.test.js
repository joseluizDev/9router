import { describe, expect, it } from "vitest";
import { openAICompletionToClaudeMessage } from "../../open-sse/handlers/chatCore/claudeResponseHelper.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { SSE_HEADERS_CORS } from "../../open-sse/utils/sseConstants.js";

describe("Claude non-streaming response translation", () => {
  it("translates Gemini / Antigravity non-streaming response into Anthropic Claude Message format", () => {
    const geminiResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { thought: true, text: "Thinking carefully..." },
              { text: "Here is the review result." }
            ]
          },
          finishReason: "STOP"
        }
      ],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        totalTokenCount: 165
      }
    };

    const result = translateNonStreamingResponse(
      geminiResponse,
      FORMATS.ANTIGRAVITY,
      FORMATS.CLAUDE
    );

    expect(result).toBeDefined();
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.id).toMatch(/^msg_/);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.content).toEqual([
      { type: "thinking", thinking: "Thinking carefully..." },
      { type: "text", text: "Here is the review result." }
    ]);
    expect(result.usage).toEqual({
      input_tokens: 120,
      output_tokens: 45
    });
  });

  it("translates OpenAI Chat Completion into Anthropic Claude Message format", () => {
    const openAIResponse = {
      id: "chatcmpl-12345",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-6.1-sol",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Approved.",
            reasoning_content: "Looks clean."
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 10,
        total_tokens: 210,
        prompt_tokens_details: {
          cached_tokens: 150
        }
      }
    };

    const result = translateNonStreamingResponse(
      openAIResponse,
      FORMATS.OPENAI,
      FORMATS.CLAUDE
    );

    expect(result).toBeDefined();
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.id).toBe("msg_12345");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.content).toEqual([
      { type: "thinking", thinking: "Looks clean." },
      { type: "text", text: "Approved." }
    ]);
    expect(result.usage).toEqual({
      input_tokens: 200,
      output_tokens: 10,
      cache_read_input_tokens: 150
    });
  });

  it("translates tool calls from OpenAI into Claude tool_use blocks", () => {
    const openAIResponse = {
      id: "chatcmpl-tool-1",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "ReadFile",
                  arguments: '{"path":"main.js"}'
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: { prompt_tokens: 50, completion_tokens: 20 }
    };

    const result = openAICompletionToClaudeMessage(openAIResponse);

    expect(result.type).toBe("message");
    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: "call_abc",
        name: "ReadFile",
        input: { path: "main.js" }
      }
    ]);
  });

  it("includes X-Accel-Buffering: no in SSE_HEADERS_CORS to prevent proxy buffering of keep-alive pings", () => {
    expect(SSE_HEADERS_CORS["X-Accel-Buffering"]).toBe("no");
  });
});
