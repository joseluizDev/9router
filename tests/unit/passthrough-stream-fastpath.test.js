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

  it("processes Claude format pure text deltas and preserves content accumulation", async () => {
    let completedContent = null;
    let completedUsage = null;

    const stream = createPassthroughStreamWithLogger(
      "claude",
      null,
      "claude-3-5-sonnet",
      "conn-1",
      { model: "claude-3-5-sonnet", messages: [{ role: "user", content: "hi" }] },
      (accumulated, usage) => {
        completedContent = accumulated.content;
        completedUsage = usage;
      }
    );

    const inputChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet","usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" from Claude!"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ];

    const output = await readStream(stream, inputChunks);

    expect(output).toContain('"text":"Hello"');
    expect(output).toContain('"text":" from Claude!"');
    expect(output).toContain('event: message_stop');

    expect(completedContent).toBe("Hello from Claude!");
    expect(completedUsage).toEqual(expect.objectContaining({
      prompt_tokens: 10,
      completion_tokens: 5
    }));
  });

  it.each([
    { type: "signature_delta", signature: "sig_abc" },
    { type: "citations_delta", citation: { type: "char_location", document_index: 0, document_title: "Source", start_char_index: 0, end_char_index: 4, cited_text: "text" } },
    { type: "thinking_delta", thinking: "" },
    { type: "text_delta", text: "" },
    { type: "input_json_delta", partial_json: "" },
  ])("preserves Claude $type event data across chunk boundaries", async (delta) => {
    const stream = createPassthroughStreamWithLogger("claude");
    const event = { type: "content_block_delta", index: 0, delta };
    const data = `data: ${JSON.stringify(event)}\n\n`;
    const output = await readStream(stream, [
      "event: content_block_delta\n",
      data.slice(0, 20),
      data.slice(20),
    ]);

    const frame = output.split("\n\n")[0];
    const payload = frame.split("\n").find(line => line.startsWith("data: "));
    expect(payload).toBeDefined();
    expect(JSON.parse(payload.slice(6))).toEqual(event);
  });

  it("processes Gemini format pure text deltas and preserves content accumulation", async () => {
    let completedContent = null;

    const stream = createPassthroughStreamWithLogger(
      "antigravity",
      null,
      "gemini-3.8-flash-high",
      "conn-1",
      null,
      (accumulated) => {
        completedContent = accumulated.content;
      }
    );

    const inputChunks = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}}\n\n',
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":" from Antigravity!"}]}}]}}\n\n',
      'data: [DONE]\n\n'
    ];

    const output = await readStream(stream, inputChunks);

    expect(output).toContain('"text":"Hello"');
    expect(output).toContain('"text":" from Antigravity!"');
    expect(output).toContain('data: [DONE]');
    expect(completedContent).toBe("Hello from Antigravity!");
  });
});
