import { fromOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { FORMATS } from "../../translator/formats.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * Convert an OpenAI Chat Completions non-streaming response body into the
 * Anthropic Claude Messages API shape ({ type: "message", role: "assistant", ... }).
 * Used when a Claude-format client (e.g. Claude Code calling /v1/messages)
 * sends a non-streaming request or retries non-streaming after a stream failure.
 */
export function openAICompletionToClaudeMessage(responseBody) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
  }
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    content.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const rawId = String(responseBody.id || `msg_${Date.now()}`);
  const msgId = rawId.startsWith("msg_") ? rawId : `msg_${rawId.replace(/^chatcmpl-/, "")}`;

  const usage = responseBody.usage || {};
  const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
  const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens || usage.cache_read_input_tokens || 0;
  const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens || usage.cache_creation_input_tokens || 0;

  const claudeUsage = {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
  };
  if (cachedTokens > 0) {
    claudeUsage.cache_read_input_tokens = cachedTokens;
  }
  if (cacheCreationTokens > 0) {
    claudeUsage.cache_creation_input_tokens = cacheCreationTokens;
  }

  return {
    id: msgId,
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: claudeUsage,
  };
}
