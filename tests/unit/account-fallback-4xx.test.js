// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { AUTH_INVALID_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it.each([
    "You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
    "INSUFFICIENT CREDITS",
    "Insufficient credit balance",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "CREDIT BALANCE IS TOO LOW",
  ])("falls back with backoff for a 400 credit error: %s", (message) => {
    expect(checkFallbackError(400, message)).toEqual({
      shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1,
    });
    expect(checkFallbackError(400, message, 1)).toEqual({
      shouldFallback: true, cooldownMs: 4000, newBackoffLevel: 2,
    });
  });

  it("does not fall back for an ordinary bad request", () => {
    expect(checkFallbackError(400, "Bad request")).toEqual({
      shouldFallback: false, cooldownMs: 0, requestScoped: true,
    });
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});

describe("checkFallbackError — account-wide cooldown (lock target)", () => {
  it("treats a bare Antigravity 403 as an account-wide rejection", () => {
    // A 403 from Google means the account itself was blocked/disabled/revoked.
    // Model-scoped locking made the dead account come back once per model on
    // every 2-minute window, ahead of healthy accounts under fill-first.
    expect(checkFallbackError(403, "HTTP 403", 0, "antigravity")).toEqual({
      shouldFallback: true,
      cooldownMs: AUTH_INVALID_COOLDOWN_MS,
      accountWide: true,
    });
  });

  it("keeps an Antigravity 403 with quota wording model-scoped", () => {
    // Text rules win over the status rule: this is throttling, not a dead account.
    const result = checkFallbackError(403, "quota exceeded for this model", 0, "antigravity");

    expect(result.accountWide).toBeUndefined();
    expect(result.newBackoffLevel).toBe(1);
  });

  it("keeps a generic 403 model-scoped", () => {
    // For other providers a 403 can simply mean "this model is not in the plan",
    // so the account must stay usable for its other models.
    expect(checkFallbackError(403, "HTTP 403", 0, "openai")).toEqual({
      shouldFallback: true,
      cooldownMs: 2 * 60 * 1000,
    });
  });

  it("treats a 401 as account-wide for every provider", () => {
    for (const provider of ["antigravity", "openai", null]) {
      const result = checkFallbackError(401, "unauthorized", 0, provider);

      expect(result).toEqual({ shouldFallback: true, cooldownMs: 2 * 60 * 1000, accountWide: true });
    }
  });

  it("does not mark rate limits account-wide", () => {
    expect(checkFallbackError(429, "too many requests", 0, "antigravity").accountWide).toBeUndefined();
  });
});
