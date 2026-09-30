import { describe, expect, it } from "vitest";
import { detectClientTool, isNativePassthrough } from "../../open-sse/utils/clientDetector.js";

describe("clientDetector", () => {
  it("detects claude tool from anthropic-version or anthropic-beta header", () => {
    expect(detectClientTool({ "anthropic-version": "2023-06-01" })).toBe("claude");
    expect(detectClientTool({ "anthropic-beta": "prompt-caching-2024-07-31" })).toBe("claude");
    expect(detectClientTool({ "Anthropic-Version": "2023-06-01" })).toBe("claude");
  });

  it("detects claude tool from user-agent with anthropic or claude-code", () => {
    expect(detectClientTool({ "user-agent": "claude-code/0.2.29" })).toBe("claude");
    expect(detectClientTool({ "user-agent": "@anthropic-ai/sdk 0.30.0" })).toBe("claude");
    expect(detectClientTool({ "x-app": "cli" })).toBe("claude");
  });

  it("checks native passthrough for claude and anthropic providers", () => {
    expect(isNativePassthrough("claude", "claude")).toBe(true);
    expect(isNativePassthrough("claude", "anthropic")).toBe(true);
    expect(isNativePassthrough("claude", "anthropic-compatible-relay")).toBe(true);
    expect(isNativePassthrough("claude", "openai")).toBe(false);
  });
});
