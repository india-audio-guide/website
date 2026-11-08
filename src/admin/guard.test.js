import { describe, expect, it } from "vitest";
import {
  ADMIN_MIN_ROLE,
  apiBasesConfigured,
  denialMessage,
  evaluateAdminClaims,
  evaluateAuthEvent,
  firebaseConfigReady,
  isE164,
  normalizePhone,
  parseRequestedEnv,
} from "./guard.js";

describe("parseRequestedEnv", () => {
  it("defaults to dev when env is omitted", () => {
    expect(parseRequestedEnv("")).toEqual({ ok: true, env: "dev", explicit: false });
    expect(parseRequestedEnv("?foo=1")).toEqual({ ok: true, env: "dev", explicit: false });
  });

  it("accepts explicit dev and prod", () => {
    expect(parseRequestedEnv("?env=dev")).toEqual({
      ok: true,
      env: "dev",
      explicit: true,
    });
    expect(parseRequestedEnv("env=prod")).toEqual({
      ok: true,
      env: "prod",
      explicit: true,
    });
  });

  it("fails closed on unknown env values and does not fall back to dev", () => {
    const result = parseRequestedEnv("?env=staging");
    expect(result.ok).toBe(false);
    expect(result.env).toBeNull();
    expect(result.error).toMatch(/Unknown environment/);
  });
});

describe("evaluateAdminClaims", () => {
  it("rejects missing claims or role", () => {
    expect(evaluateAdminClaims(undefined)).toMatchObject({
      allowed: false,
      reason: "missing-claims",
    });
    expect(evaluateAdminClaims({})).toMatchObject({
      allowed: false,
      reason: "missing-role",
    });
    expect(evaluateAdminClaims({ internal_id: "usr_x" })).toMatchObject({
      allowed: false,
      reason: "missing-role",
    });
    expect(evaluateAdminClaims({ role: null })).toMatchObject({
      allowed: false,
      reason: "missing-role",
    });
  });

  it("rejects roles below 10 per service policy", () => {
    expect(ADMIN_MIN_ROLE).toBe(10);
    for (const role of [1, 5, 9, 0, -1]) {
      expect(evaluateAdminClaims({ role })).toEqual({
        allowed: false,
        reason: "insufficient-role",
        role,
      });
    }
  });

  it("rejects malformed roles without coercing them", () => {
    for (const role of ["10", "admin", 10.5, true, { n: 10 }, ["10"]]) {
      expect(evaluateAdminClaims({ role })).toMatchObject({
        allowed: false,
        reason: "malformed-role",
      });
    }
  });

  it("accepts integer role >= 10", () => {
    expect(evaluateAdminClaims({ role: 10 })).toEqual({
      allowed: true,
      reason: "admin",
      role: 10,
    });
    expect(evaluateAdminClaims({ role: 11, internal_id: "usr_x" })).toEqual({
      allowed: true,
      reason: "admin",
      role: 11,
    });
  });
});

describe("evaluateAuthEvent", () => {
  const user = { uid: "abc" };

  it("is signed-out when there is no user (restore/token loss)", () => {
    expect(evaluateAuthEvent({ user: null })).toEqual({
      state: "signed-out",
      reason: "no-user",
    });
    expect(evaluateAuthEvent({})).toEqual({
      state: "signed-out",
      reason: "no-user",
    });
  });

  it("requires sign-out when the token cannot be read", () => {
    expect(
      evaluateAuthEvent({ user, tokenError: new Error("network") }),
    ).toEqual({ state: "sign-out-required", reason: "token-error" });
  });

  it("stays checking until a token result exists", () => {
    expect(evaluateAuthEvent({ user })).toEqual({
      state: "checking",
      reason: "awaiting-token",
    });
  });

  it("requires sign-out when claims are not admin", () => {
    expect(
      evaluateAuthEvent({ user, tokenResult: { claims: { role: 5 } } }),
    ).toMatchObject({ state: "sign-out-required", reason: "insufficient-role" });
    expect(
      evaluateAuthEvent({ user, tokenResult: { claims: {} } }),
    ).toMatchObject({ state: "sign-out-required", reason: "missing-role" });
  });

  it("accepts an admin token", () => {
    expect(
      evaluateAuthEvent({ user, tokenResult: { claims: { role: 10 } } }),
    ).toEqual({ state: "admin", allowed: true, reason: "admin", role: 10 });
  });
});

describe("denialMessage", () => {
  it("explains unauthorized and token-loss cases without leaking details", () => {
    expect(denialMessage("insufficient-role")).toMatch(/not authorized/i);
    expect(denialMessage("token-error")).toMatch(/signed out/i);
    expect(denialMessage("no-user")).toMatch(/session ended/i);
  });
});

describe("phone helpers", () => {
  it("normalizes 10-digit Indian numbers to E.164", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+447700900123")).toBe("+447700900123");
    expect(isE164("+919876543210")).toBe(true);
    expect(isE164("9876543210")).toBe(false);
  });
});

describe("env readiness", () => {
  it("does not treat empty prod API bases as configured", () => {
    expect(
      apiBasesConfigured({
        apis: { user: "", content: "", media: "", payment: "" },
      }),
    ).toBe(false);
    expect(
      apiBasesConfigured({
        apis: {
          user: "https://example.test/user",
          content: "https://example.test/content",
          media: "https://example.test/media",
          payment: "https://example.test/payment",
        },
      }),
    ).toBe(true);
  });

  it("requires public Firebase fields", () => {
    expect(firebaseConfigReady({ firebase: { apiKey: "", projectId: "x" } })).toBe(
      false,
    );
    expect(
      firebaseConfigReady({
        firebase: {
          apiKey: "public",
          authDomain: "x.firebaseapp.com",
          projectId: "x",
        },
      }),
    ).toBe(true);
  });
});
