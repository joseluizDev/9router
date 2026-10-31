import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let POST, PUT, getModelInfo, getComboModels;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-slash-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  ({ POST } = await import("@/app/api/combos/route.js"));
  ({ PUT } = await import("@/app/api/combos/[id]/route.js"));
  ({ getModelInfo, getComboModels } = await import("@/sse/services/model.js"));
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

function request(method, body) {
  return new Request("http://localhost/api/combos", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

const members = ["openai/gpt-5", "zro/deepseek-v4.1-flash"];

describe("combo names containing slashes", () => {
  it.each(["ag/", "ag/my-combo", "team/code/fast", "legacy-combo_1.0"])("creates, renames and routes %s by its complete name", async (name) => {
    const response = await POST(request("POST", { name, models: members }));
    expect(response.status).toBe(201);
    const combo = await response.json();
    expect(combo).toMatchObject({ name, models: members });
    await expect(getComboModels(name)).resolves.toEqual(members);
    await expect(getModelInfo(name)).resolves.toEqual({ provider: null, model: name });

    const renamed = `${name}/renamed`;
    const updated = await PUT(request("PUT", { name: renamed }), { params: Promise.resolve({ id: combo.id }) });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ name: renamed, models: members });
    await expect(getComboModels(renamed)).resolves.toEqual(members);
    await expect(getComboModels(name)).resolves.toBeNull();
  });

  it.each(["bad name", "bad?name", "bad#name", "bad\\name", 123, ["ag/combo"]])("rejects unsupported name %j on create and update", async (name) => {
    expect((await POST(request("POST", { name, models: members }))).status).toBe(400);
    expect((await PUT(request("PUT", { name }), { params: Promise.resolve({ id: "not-written" }) })).status).toBe(400);
  });

  it("keeps exact-match duplicate detection with slashes", async () => {
    const name = "ag/duplicate";
    expect((await POST(request("POST", { name, models: members }))).status).toBe(201);
    expect((await POST(request("POST", { name, models: members }))).status).toBe(400);
  });

  it("preserves provider routing when no combo has that exact name", async () => {
    await expect(getComboModels("zro/glm-5.3")).resolves.toBeNull();
    await expect(getModelInfo("zro/glm-5.3")).resolves.toEqual({ provider: "zro", model: "glm-5.3" });
    await expect(getComboModels("ag/missing")).resolves.toBeNull();
  });

  it.each([false, true])("finds slash names in the standalone engine (object wrapper=%s)", (wrapped) => {
    const combos = [{ name: "ag/", models: members }];
    const data = wrapped ? { combos } : combos;
    expect(getComboModelsFromData("ag/", data)).toEqual(members);
    expect(getComboModelsFromData("ag/missing", data)).toBeNull();
    expect(getComboModelsFromData("openai/gpt-5", data)).toBeNull();
  });
});
