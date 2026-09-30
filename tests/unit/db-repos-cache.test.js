import { describe, expect, it } from "vitest";
import {
  createCombo,
  createProviderNode,
  deleteCombo,
  deleteProviderNode,
  getCombos,
  getProviderNodes,
  getSettings,
  invalidateSettingsCache,
  updateSettings,
} from "../../src/lib/db/index.js";

describe("db repos in-memory caching", () => {
  it("caches settings in memory and updates on updateSettings", async () => {
    invalidateSettingsCache();
    const s1 = await getSettings();
    expect(s1).toBeDefined();

    const s2 = await getSettings();
    expect(s1).toBe(s2); // Exact same object reference from cache

    await updateSettings({ mitmRouterBaseUrl: "http://localhost:20129" });
    const s3 = await getSettings();
    expect(s3.mitmRouterBaseUrl).toBe("http://localhost:20129");
  });

  it("caches providerNodes in memory and invalidates on mutations", async () => {
    const initial = await getProviderNodes({ type: "openai-compatible" });
    expect(Array.isArray(initial)).toBe(true);

    const node = await createProviderNode({
      name: "Test Local Node",
      prefix: "test-local",
      type: "openai-compatible",
      baseUrl: "http://localhost:1234/v1"
    });

    const updated = await getProviderNodes({ type: "openai-compatible" });
    const found = updated.find(n => n.id === node.id);
    expect(found).toBeDefined();
    expect(found.prefix).toBe("test-local");

    await deleteProviderNode(node.id);
    const afterDelete = await getProviderNodes({ type: "openai-compatible" });
    expect(afterDelete.find(n => n.id === node.id)).toBeUndefined();
  });

  it("caches combos in memory and invalidates on mutations", async () => {
    const initial = await getCombos();
    expect(Array.isArray(initial)).toBe(true);

    const combo = await createCombo({
      name: "test-claude-combo",
      models: ["claude-3-5-sonnet", "gpt-4o"]
    });

    const updated = await getCombos();
    expect(updated.find(c => c.name === "test-claude-combo")).toBeDefined();

    await deleteCombo(combo.id);
    const afterDelete = await getCombos();
    expect(afterDelete.find(c => c.name === "test-claude-combo")).toBeUndefined();
  });
});
