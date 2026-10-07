import { describe, expect, it, vi } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Translated streams emit nothing while the upstream reasons or while tool
// arguments are buffered. Claude Code aborts a stream after ~180s without any
// event, so Claude-format clients must get periodic ping events meanwhile.
const encoder = new TextEncoder();

function pipe(sourceFormat) {
  let source;
  const input = new ReadableStream({ start(c) { source = c; } });
  const output = input.pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, sourceFormat, "codex", null, null, "gpt-test"),
  );
  return { source, reader: output.getReader() };
}

async function readAll(reader) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

const pings = (text) => text.split("\n\n").filter((frame) => frame === 'event: ping\ndata: {"type":"ping"}').length;

describe("Claude stream keepalive", () => {
  it("sends ping events to Claude clients while the upstream is silent", async () => {
    vi.useFakeTimers();
    try {
      const { source, reader } = pipe(FORMATS.CLAUDE);
      source.enqueue(encoder.encode('event: response.created\ndata: {"type":"response.created","response":{"id":"r1"}}\n\n'));
      await vi.advanceTimersByTimeAsync(45000);
      source.close();

      expect(pings(await readAll(reader))).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops pinging once the stream has finished", async () => {
    vi.useFakeTimers();
    try {
      const { source, reader } = pipe(FORMATS.CLAUDE);
      source.close();
      const text = await readAll(reader);
      await vi.advanceTimersByTimeAsync(60000);

      expect(pings(text)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ping non-Claude clients", async () => {
    vi.useFakeTimers();
    try {
      const { source, reader } = pipe(FORMATS.OPENAI);
      await vi.advanceTimersByTimeAsync(45000);
      source.close();

      expect(pings(await readAll(reader))).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
