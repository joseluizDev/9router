import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";

describe("Gemini 3.8 Flash Support & Config", () => {
  it("registers gemini-3.8-flash tiered models in antigravity provider registry", () => {
    const agIds = antigravityRegistry.models.map(m => m.id);
    expect(agIds).toContain("gemini-3.8-flash-high");
    expect(agIds).toContain("gemini-3.8-flash-medium");
    expect(agIds).toContain("gemini-3.8-flash-low");
    expect(agIds).not.toContain("gemini-3.8-flash");

    const highModel = antigravityRegistry.models.find(m => m.id === "gemini-3.8-flash-high");
    expect(highModel.upstreamModelId).toBe("gemini-3.7-flash-tiered(high)");
    const medModel = antigravityRegistry.models.find(m => m.id === "gemini-3.8-flash-medium");
    expect(medModel.upstreamModelId).toBe("gemini-3.7-flash-tiered(medium)");
    const lowModel = antigravityRegistry.models.find(m => m.id === "gemini-3.8-flash-low");
    expect(lowModel.upstreamModelId).toBe("gemini-3.7-flash-tiered(low)");
  });

  it("registers gemini-3.8-flash in gemini provider registry", () => {
    const geminiIds = geminiRegistry.models.map(m => m.id);
    expect(geminiIds).toContain("gemini-3.8-flash");
  });

  it("resolves capabilities correctly for gemini-3.8 models with official limits", () => {
    const caps = getCapabilitiesForModel("antigravity", "gemini-3.8-flash-high");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
  });

  it("defines pricing matching gemini-3.7-flash baseline", () => {
    expect(MODEL_PRICING["gemini-3.8-flash"]).toEqual(MODEL_PRICING["gemini-3.7-flash"]);
    expect(MODEL_PRICING["gemini-3.8-flash-high"]).toEqual(MODEL_PRICING["gemini-3.7-flash-high"]);
    expect(MODEL_PRICING["gemini-3.8-flash-medium"]).toEqual(MODEL_PRICING["gemini-3.7-flash-medium"]);
    expect(MODEL_PRICING["gemini-3.8-flash-low"]).toEqual(MODEL_PRICING["gemini-3.7-flash-low"]);
  });

  it("buildUrl routes gemini-3.8 to daily-cloudcode-pa streaming endpoint", () => {
    const executor = new AntigravityExecutor();
    const url = executor.buildUrl("gemini-3.8-flash-tiered", true);
    expect(url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse");
  });
});
