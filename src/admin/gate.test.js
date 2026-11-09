// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolsDecision } from "./guard.js";
import { ENVS } from "./config.js";

const fb = vi.hoisted(() => ({ auth: null, onState: null, onToken: null, signOut: null }));

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => fb.auth,
  setPersistence: async () => {},
  browserSessionPersistence: {},
  onAuthStateChanged: (_a, cb) => { fb.onState = cb; },
  onIdTokenChanged: (_a, cb) => { fb.onToken = cb; },
  signOut: (...a) => fb.signOut(...a),
  signInWithPhoneNumber: vi.fn(),
  RecaptchaVerifier: class { clear() {} },
}));

const html = readFileSync(resolve(process.cwd(), "admin/index.html"), "utf8");
const body = html.slice(html.indexOf("<body"), html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/^<body[^>]*>/, "");
const flush = () => new Promise((r) => setTimeout(r, 0));

function user(claims) {
  return {
    phoneNumber: null,
    getIdTokenResult: async () => ({ claims }),
    getIdToken: async () => "tok",
  };
}

async function boot() {
  vi.resetModules();
  document.body.innerHTML = body;
  fb.auth = { currentUser: null };
  fb.signOut = vi.fn(async () => { fb.auth.currentUser = null; });
  const fetchMock = vi.fn(async (url) => new Response(JSON.stringify(String(url).includes("/states") ? { items: [] } : { items: [], total: 0, limit: 25, offset: 0 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await import("./main.js");
  await flush();
  return fetchMock;
}

async function signIn(claims) {
  const u = user(claims);
  fb.auth.currentUser = u;
  fb.onState(u);
  await flush();
  await flush();
  return u;
}

const tools = () => document.getElementById("admin-tools");

describe("admin tools stay behind the role gate", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("toolsDecision only mounts for admins with configured APIs", () => {
    expect(toolsDecision({ state: "admin" }, ENVS.dev)).toBe("mount");
    expect(toolsDecision({ state: "admin" }, ENVS.prod)).toBe("not-configured");
    for (const state of ["signed-out", "sign-out-required", "checking", undefined]) {
      expect(toolsDecision({ state }, ENVS.dev)).toBe("hide");
    }
  });

  it("the tools container is hidden and empty in the static HTML", () => {
    document.body.innerHTML = body;
    expect(tools().hidden).toBe(true);
    expect(tools().children).toHaveLength(0);
  });

  for (const [label, claims] of [["role 1", { role: 1 }], ["missing role", {}], ["string role", { role: "10" }]]) {
    it(`a ${label} user is signed out and never sees the tools or calls the APIs`, async () => {
      const fetchMock = await boot();
      await signIn(claims);
      expect(fb.signOut).toHaveBeenCalled();
      expect(tools().hidden).toBe(true);
      expect(tools().children).toHaveLength(0);
      expect(document.getElementById("signed-in").hidden).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("an admin sees the tools; signing out removes them", async () => {
    const fetchMock = await boot();
    await signIn({ role: 10 });
    expect(fb.signOut).not.toHaveBeenCalled();
    expect(tools().hidden).toBe(false);
    expect(tools().querySelector("h2")?.textContent).toBe("Places");
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/5yhpykl6wg\.execute-api\.ap-south-2\.amazonaws\.com\/dev\/v1\/admin\/places\?/);
    expect(init.headers.authorization).toBe("Bearer tok");

    document.getElementById("sign-out").click();
    await flush();
    expect(tools().hidden).toBe(true);
    expect(tools().children).toHaveLength(0);
  });

  it("a later token without the admin role removes the tools", async () => {
    await boot();
    await signIn({ role: 10 });
    expect(tools().hidden).toBe(false);
    const demoted = user({ role: 1 });
    fb.auth.currentUser = demoted;
    fb.onToken(demoted);
    await flush();
    await flush();
    expect(fb.signOut).toHaveBeenCalled();
    expect(tools().hidden).toBe(true);
    expect(tools().children).toHaveLength(0);
  });
});
