import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function readStream(stream, chunks) {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Write all chunks
  (async () => {
    for (const chunk of chunks) {
      await writer.write(encoder.encode(chunk));
    }
    await writer.close();
  })();

  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

describe("passthrough stream fast-path", () => {
  it("processes pure content deltas and preserves content accumulation", async () => {
    let completedContent = null;
    let completedUsage = null;

    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      "gpt-4o",
      "conn-1",
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      (accumulated, usage) => {
        completedContent = accumulated.content;
        completedUsage = usage;
      }
    );

    const inputChunks = [
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" world!"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
      'data: [DONE]\n\n'
    ];

    const output = await readStream(stream, inputChunks);

    // Verify output passes through all events
    expect(output).toContain('"content":"Hello"');
    expect(output).toContain('"content":" world!"');
    expect(output).toContain('data: [DONE]');

    // Verify accumulation worked
    expect(completedContent).toBe("Hello world!");
    expect(completedUsage).toEqual(expect.objectContaining({
      prompt_tokens: 5,
      completion_tokens: 3
    }));
  });

  it("handles multi-byte unicode and escaped characters correctly in fast-path", async () => {
    let completedContent = null;

    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      "gpt-4o",
      "conn-1",
      null,
      (accumulated) => {
        completedContent = accumulated.content;
      }
    );

    const inputChunks = [
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1700000000,"choices":[{"index":0,"delta":{"content":"Line 1\\nLine 2 \\"quoted\\" 🚀"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const output = await readStream(stream, inputChunks);

    expect(output).toContain('Line 1\\nLine 2 \\"quoted\\" 🚀');
    expect(completedContent).toBe('Line 1\nLine 2 "quoted" 🚀');
  });
});
