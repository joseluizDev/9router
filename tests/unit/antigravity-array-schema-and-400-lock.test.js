import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("Array Schema Sanitization for Gemini / Antigravity", () => {
  it("repairs nested array without items field (where.items.items)", () => {
    const input = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: {
              type: "array",
              items: {
                type: "array"
                // missing items
              }
            }
          }
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(input));
    const where = cleaned.properties.query.properties.where;
    expect(where.type).toBe("array");
    expect(where.items).toBeDefined();
    expect(where.items.type).toBe("array");
    expect(where.items.items).toBeDefined();
    expect(where.items.items.type).toBe("string");
  });

  it("repairs array with missing items", () => {
    const input = {
      type: "object",
      properties: {
        tags: {
          type: "array"
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(input));
    expect(cleaned.properties.tags.type).toBe("array");
    expect(cleaned.properties.tags.items).toEqual({ type: "string" });
  });

  it("repairs array with empty object items", () => {
    const input = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(input));
    expect(cleaned.properties.tags.items).toEqual({ type: "string" });
  });

  it("converts tuple array items to single schema object", () => {
    const input = {
      type: "object",
      properties: {
        pair: {
          type: "array",
          items: [{ type: "string" }, { type: "number" }]
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(input));
    expect(cleaned.properties.pair.items).toEqual({ type: "string" });
  });

  it("infers type=array when items field exists without explicit type", () => {
    const input = {
      type: "object",
      properties: {
        list: {
          items: { type: "string" }
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(input));
    expect(cleaned.properties.list.type).toBe("array");
  });
});

describe("Account Fallback 400 Lock Prevention", () => {
  it("does not fallback or lock accounts on HTTP 400 Bad Request", () => {
    const errorMsg = '{"error":{"code":400,"message":"* GenerateContentRequest.tools[0].function_declarations[1].parameters.properties[query].properties[where].items.items: missing field.","status":"INVALID_ARGUMENT"}}';
    const result = checkFallbackError(400, errorMsg);
    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
  });

  it("still falls back on 401, 403, 404, 429", () => {
    expect(checkFallbackError(401, "").shouldFallback).toBe(true);
    expect(checkFallbackError(403, "").shouldFallback).toBe(true);
    expect(checkFallbackError(404, "").shouldFallback).toBe(true);
    expect(checkFallbackError(429, "").shouldFallback).toBe(true);
  });
});
