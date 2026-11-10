// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  logoSrcForTheme,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  syncThemeToggleButton,
  systemPrefersDark,
  themeColorForTheme,
  themeToggleLabel,
  writeStoredTheme,
} from "./theme.js";

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

describe("admin theme helpers", () => {
  it("defaults to the system preference when nothing is stored", () => {
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(readStoredTheme({ getItem: () => null })).toBeNull();
  });

  it("persists and restores a chosen theme", () => {
    const store = new Map();
    const storage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    };
    writeStoredTheme(storage, "dark");
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme(storage)).toBe("dark");
    writeStoredTheme(storage, "light");
    expect(readStoredTheme(storage)).toBe("light");
  });

  it("lets an explicit choice beat prefers-color-scheme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("applyTheme sets data-theme only for a stored choice", () => {
    const root = document.createElement("html");
    const meta = document.createElement("meta");
    const logo = document.createElement("img");

    applyTheme({
      stored: null,
      prefersDark: true,
      root,
      metaThemeColor: meta,
      logo,
    });
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(logo.getAttribute("src")).toBe("/icons/icon_dark.svg");
    expect(meta.getAttribute("content")).toBe(themeColorForTheme("dark"));

    applyTheme({
      stored: "light",
      prefersDark: true,
      root,
      metaThemeColor: meta,
      logo,
    });
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(logo.getAttribute("src")).toBe("/icons/icon_light.svg");
    expect(meta.getAttribute("content")).toBe(themeColorForTheme("light"));

    applyTheme({
      stored: "dark",
      prefersDark: false,
      root,
      metaThemeColor: meta,
      logo,
    });
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(logo.getAttribute("src")).toBe(logoSrcForTheme("dark"));
  });

  it("toggle switches resolved theme and updates the accessible name", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(themeToggleLabel("light")).toBe("Switch to dark mode");
    expect(themeToggleLabel("dark")).toBe("Switch to light mode");
    const button = document.createElement("button");
    syncThemeToggleButton(button, "dark");
    expect(button.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(button.dataset.theme).toBe("dark");
  });

  it("systemPrefersDark reads matchMedia", () => {
    expect(systemPrefersDark({ matches: true })).toBe(true);
    expect(systemPrefersDark({ matches: false })).toBe(false);
  });
});

describe("admin theme toggle in the page", () => {
  const html = readFileSync(resolve(process.cwd(), "admin/index.html"), "utf8");
  const body = html
    .slice(html.indexOf("<body"), html.indexOf("</body>"))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/^<body[^>]*>/, "");

  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  async function boot(prefersDark = false) {
    vi.resetModules();
    document.head.innerHTML = '<meta name="theme-color" content="#B4441A" />';
    document.body.innerHTML = body;
    fb.auth = { currentUser: null };
    fb.signOut = vi.fn(async () => {
      fb.auth.currentUser = null;
    });
    fb.signInWithPhoneNumber = vi.fn(async () => ({ confirm: async () => ({}) }));
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query) => ({
        matches: Boolean(prefersDark) && String(query).includes("dark"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await import("./main.js");
    await flush();
  }

  it("follows the system when unset and the toggle persists a choice that beats it", async () => {
    await boot(true);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.getElementById("admin-logo").getAttribute("src")).toBe(
      "/icons/icon_dark.svg",
    );
    const toggle = document.getElementById("theme-toggle");
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Switch to light mode");

    toggle.click();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.getElementById("admin-logo").getAttribute("src")).toBe(
      "/icons/icon_light.svg",
    );
    expect(toggle.getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(
      document.querySelector('meta[name="theme-color"]').getAttribute("content"),
    ).toBe("#B4441A");

    await boot(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.getElementById("admin-logo").getAttribute("src")).toBe(
      "/icons/icon_light.svg",
    );
  });
});
