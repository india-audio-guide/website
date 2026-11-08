import { describe, expect, it } from "vitest";
import { explainFirebaseError, safeAuthCode } from "./errors.js";

describe("safeAuthCode", () => {
  it("accepts well-formed auth codes only", () => {
    expect(safeAuthCode({ code: "auth/captcha-check-failed" })).toBe(
      "auth/captcha-check-failed",
    );
    expect(safeAuthCode({ code: "auth/invalid-app-credential" })).toBe(
      "auth/invalid-app-credential",
    );
    expect(safeAuthCode({ code: "not-a-firebase-code" })).toBeNull();
    expect(safeAuthCode({ code: "auth/../secret" })).toBeNull();
    expect(safeAuthCode({ code: "AUTH/CAPTCHA-CHECK-FAILED" })).toBeNull();
    expect(safeAuthCode({})).toBeNull();
    expect(safeAuthCode(undefined)).toBeNull();
  });
});

describe("explainFirebaseError", () => {
  it("distinguishes captcha-check-failed from invalid-app-credential", () => {
    const captcha = explainFirebaseError({ code: "auth/captcha-check-failed" });
    const appCred = explainFirebaseError({
      code: "auth/invalid-app-credential",
    });
    expect(captcha).not.toBe(appCred);
    expect(captcha).toContain("auth/captcha-check-failed");
    expect(captcha).toMatch(/authorized domains/i);
    expect(appCred).toContain("auth/invalid-app-credential");
    expect(appCred).toMatch(/app verifier/i);
    expect(captcha).not.toContain("The reCAPTCHA check failed. Reload the page and try again.");
    expect(appCred).not.toContain("The reCAPTCHA check failed. Reload the page and try again.");
  });

  it("gives distinct guidance for domain, quota, missing token, and provider errors", () => {
    expect(explainFirebaseError({ code: "auth/unauthorized-domain" })).toMatch(
      /india-audio-guide\.github\.io/,
    );
    expect(explainFirebaseError({ code: "auth/unauthorized-domain" })).toContain(
      "auth/unauthorized-domain",
    );
    expect(explainFirebaseError({ code: "auth/app-not-authorized" })).toMatch(
      /API key/,
    );
    expect(explainFirebaseError({ code: "auth/missing-app-credential" })).toMatch(
      /did not receive a reCAPTCHA token/,
    );
    expect(explainFirebaseError({ code: "auth/quota-exceeded" })).toMatch(/quota/i);
    expect(explainFirebaseError({ code: "auth/too-many-requests" })).toMatch(
      /Too many attempts/,
    );
    expect(explainFirebaseError({ code: "auth/operation-not-allowed" })).toMatch(
      /SMS region policy/,
    );
  });

  it("never echoes tokens or phone numbers from the raw error", () => {
    const message = explainFirebaseError({
      code: "auth/captcha-check-failed",
      message: "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb phone +919876543210",
      customData: { phoneNumber: "+919876543210" },
    });
    expect(message).not.toMatch(/eyJ/);
    expect(message).not.toMatch(/\+919876543210/);
    expect(message).not.toMatch(/aaa\.bbb/);
  });

  it("includes an unknown but well-formed auth code without inventing details", () => {
    const message = explainFirebaseError({ code: "auth/some-new-code" });
    expect(message).toContain("auth/some-new-code");
    expect(message).toMatch(/something went wrong/i);
  });
});
