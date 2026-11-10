// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nationalDigitsFromPhoneInput, normalizePhone } from "./guard.js";

const fb = vi.hoisted(() => ({
  auth: null,
  onState: null,
  onToken: null,
  signOut: null,
  signInWithPhoneNumber: null,
}));

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => fb.auth,
  setPersistence: async () => {},
  browserSessionPersistence: {},
  onAuthStateChanged: (_a, cb) => {
    fb.onState = cb;
  },
  onIdTokenChanged: (_a, cb) => {
    fb.onToken = cb;
  },
  signOut: (...a) => fb.signOut(...a),
  signInWithPhoneNumber: (...a) => fb.signInWithPhoneNumber(...a),
  RecaptchaVerifier: class {
    clear() {}
  },
}));

const html = readFileSync(resolve(process.cwd(), "admin/index.html"), "utf8");
const body = html
  .slice(html.indexOf("<body"), html.indexOf("</body>"))
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/^<body[^>]*>/, "");
const flush = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  vi.resetModules();
  document.body.innerHTML = body;
  fb.auth = { currentUser: null };
  fb.signOut = vi.fn(async () => {
    fb.auth.currentUser = null;
  });
  fb.signInWithPhoneNumber = vi.fn(async (_auth, phone) => ({
    phone,
    confirm: async () => ({}),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  await import("./main.js");
  await flush();
}

describe("admin login +91 phone field", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("shows a fixed +91 prefix that is not part of the editable value", () => {
    document.body.innerHTML = body;
    const prefix = document.querySelector(".phone-prefix");
    const input = document.getElementById("phone");
    const label = document.querySelector('label[for="phone"]');
    expect(label?.textContent).toBe("Mobile number");
    expect(prefix?.textContent).toBe("+91");
    expect(input?.value).toBe("");
    expect(input?.closest(".phone-field")).toContain(prefix);
    // Prefix is a sibling span, not editable text in the input.
    expect(input?.tagName).toBe("INPUT");
    expect(prefix?.tagName).toBe("SPAN");
    expect(prefix?.getAttribute("aria-hidden")).toBe("true");
  });

  it("cannot delete +91 because the prefix is outside the input", () => {
    document.body.innerHTML = body;
    const input = document.getElementById("phone");
    input.value = "9876543210";
    input.value = "";
    expect(document.querySelector(".phone-prefix")?.textContent).toBe("+91");
    expect(normalizePhone(input.value)).toBe("");
  });

  it("submits a 10-digit national number as +91… E.164", async () => {
    await boot();
    const input = document.getElementById("phone");
    input.value = "9876543210";
    document.getElementById("login-form").requestSubmit();
    await flush();
    await flush();
    expect(fb.signInWithPhoneNumber).toHaveBeenCalled();
    expect(fb.signInWithPhoneNumber.mock.calls[0][1]).toBe("+919876543210");
  });

  it("pasting +9198… or 91… strips the country code and still signs in with E.164", async () => {
    await boot();
    const input = document.getElementById("phone");

    input.value = "+919876543210";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("9876543210");
    expect(nationalDigitsFromPhoneInput("+919876543210")).toBe("9876543210");

    document.getElementById("login-form").requestSubmit();
    await flush();
    await flush();
    expect(fb.signInWithPhoneNumber.mock.calls[0][1]).toBe("+919876543210");

    fb.signInWithPhoneNumber.mockClear();
    document.getElementById("change-number")?.click();
    // Still on phone stage if send never succeeded; reset anyway via fresh value.
    input.value = "919876543210";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("9876543210");
    document.getElementById("login-form").requestSubmit();
    await flush();
    await flush();
    expect(fb.signInWithPhoneNumber.mock.calls[0][1]).toBe("+919876543210");
  });

  it("shows Enter a mobile number when the number is too short", async () => {
    await boot();
    const input = document.getElementById("phone");
    input.value = "98";
    document.getElementById("login-form").requestSubmit();
    await flush();
    expect(fb.signInWithPhoneNumber).not.toHaveBeenCalled();
    expect(document.getElementById("error").textContent).toBe(
      "Enter a mobile number.",
    );
    expect(document.getElementById("primary-action").textContent).toBe(
      "Send code",
    );
  });
});
