// @vitest-environment jsdom
// Regression: sign-in chrome stayed on screen after login and after a reload that restored the
// session, because component display rules (.admin-form grid) beat the [hidden] attribute.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fb = vi.hoisted(() => ({ auth: null, onState: null, onToken: null, signOut: null, confirm: null, verifierCleared: 0 }));

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => fb.auth,
  setPersistence: async () => {},
  browserSessionPersistence: {},
  onAuthStateChanged: (_a, cb) => { fb.onState = cb; },
  onIdTokenChanged: (_a, cb) => { fb.onToken = cb; },
  signOut: (...a) => fb.signOut(...a),
  signInWithPhoneNumber: async () => ({ confirm: (code) => fb.confirm(code) }),
  RecaptchaVerifier: class { clear() { fb.verifierCleared += 1; } },
}));

const root = process.cwd();
const html = readFileSync(resolve(root, "admin/index.html"), "utf8");
const body = html.slice(html.indexOf("<body"), html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/^<body[^>]*>/, "");
// Real admin CSS (minus the shared @import, which jsdom cannot resolve) so computed display is tested.
const css = readFileSync(resolve(root, "src/admin/admin.css"), "utf8").replace(/@import[^;]+;/g, "");
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const $ = (id) => document.getElementById(id);
// Rendered = neither the element nor any ancestor computes to display:none.
const shown = (id) => {
  for (let el = $(id); el && el.nodeType === 1; el = el.parentElement) {
    if (getComputedStyle(el).display === "none") return false;
  }
  return true;
};

function adminUser() {
  return { phoneNumber: "+919876543210", getIdTokenResult: async () => ({ claims: { role: 10 } }), getIdToken: async () => "tok" };
}

async function boot({ restored = null } = {}) {
  vi.resetModules();
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = body;
  fb.auth = { currentUser: restored };
  fb.verifierCleared = 0;
  fb.signOut = vi.fn(async () => { fb.auth.currentUser = null; });
  vi.stubGlobal("fetch", vi.fn(async (url) => new Response(JSON.stringify(String(url).includes("/states") ? { items: [] } : { items: [], total: 0, limit: 25, offset: 0 }), { status: 200 })));
  await import("./main.js");
  await flush();
}

const CHROME = ["page-title", "intro", "login-form", "phone", "recaptcha-container", "primary-action"];

function expectSignInChromeHidden() {
  for (const id of ["intro", "login-form", "code-field", "change-number", "status", "error", "checking"]) {
    expect(shown(id), `${id} should not render`).toBe(false);
  }
  // Nothing inside the form (phone, reCAPTCHA, Send code/Verify) can render once the form is hidden.
  for (const id of ["phone", "recaptcha-container", "primary-action"]) {
    expect($(id).closest("[hidden]"), `${id} inside a hidden ancestor`).not.toBeNull();
  }
  expect($("page-title").textContent).toBe("Admin");
  expect(document.title).toMatch(/^Admin ·/);
  expect(shown("header-sign-out")).toBe(true);
  expect(shown("signed-in")).toBe(true);
}

function expectSignInChromeVisible() {
  for (const id of CHROME) expect(shown(id), `${id} should render`).toBe(true);
  expect($("page-title").textContent).toBe("Sign in");
  expect(shown("header-sign-out")).toBe(false);
  expect(shown("checking")).toBe(false);
  expect(shown("code-field")).toBe(false);
}

describe("admin sign-in chrome", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("CSS: [hidden] wins over component display rules", () => {
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.innerHTML = body;
    $("login-form").hidden = true;
    $("code-field").hidden = true;
    expect(getComputedStyle($("login-form")).display).toBe("none");
    expect(getComputedStyle($("code-field")).display).toBe("none");
  });

  it("static HTML starts in a neutral loading state, not the login form", () => {
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.innerHTML = body;
    expect(shown("checking")).toBe(true);
    for (const id of ["page-title", "intro", "login-form", "header-sign-out", "signed-in"]) {
      expect(shown(id), id).toBe(false);
    }
  });

  it("before auth resolves the login form does not flash; signed-out then shows it", async () => {
    await boot();
    expect(shown("checking")).toBe(true);
    expect(shown("login-form")).toBe(false);
    expect(shown("page-title")).toBe(false);
    fb.onState(null);
    await flush();
    expectSignInChromeVisible();
  });

  it("restored session on reload: admin view, no sign-in chrome, logout visible; sign-out restores it", async () => {
    const u = adminUser();
    await boot({ restored: u });
    expect(shown("login-form")).toBe(false);
    fb.onState(u);
    fb.onToken(u);
    await flush();
    expectSignInChromeHidden();

    $("header-sign-out").click();
    await flush();
    expect(fb.signOut).toHaveBeenCalled();
    expectSignInChromeVisible();
    expect($("status").textContent).toBe("You have signed out.");
  });

  it("fresh login via SMS code: admin view hides chrome and clears reCAPTCHA; sign-out restores it", async () => {
    await boot();
    fb.onState(null);
    await flush();
    expectSignInChromeVisible();

    const u = adminUser();
    fb.confirm = vi.fn(async () => {
      fb.auth.currentUser = u;
      fb.onState(u);
      return { user: u };
    });
    $("phone").value = "9876543210";
    $("login-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect($("primary-action").textContent).toBe("Verify");
    expect(shown("code-field")).toBe(true);

    $("code").value = "123456";
    $("login-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fb.confirm).toHaveBeenCalledWith("123456");
    expectSignInChromeHidden();
    expect(fb.verifierCleared).toBeGreaterThan(0);

    $("header-sign-out").click();
    await flush();
    expectSignInChromeVisible();
    expect($("primary-action").textContent).toBe("Send code");
  });
});
