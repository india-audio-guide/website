// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { loadScriptEditors, renderScriptsPanel, saveScript, scriptTargetQuery } from "./scripts.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe("script helpers", () => {
  it("builds place_id or spot_id target queries", () => {
    expect(scriptTargetQuery("place", "plc_AbCdEfGhIjKl")).toEqual({ place_id: "plc_AbCdEfGhIjKl" });
    expect(scriptTargetQuery("spot", "spt_AbCdEfGhIjKl")).toEqual({ spot_id: "spt_AbCdEfGhIjKl" });
    expect(() => scriptTargetQuery("collection", "col_x")).toThrow(/place or spot/);
  });
});

describe("narration scripts panel", () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="r"></div>';
    root = document.getElementById("r");
  });

  it("loads languages and skim/detailed content, then saves a skim upsert", async () => {
    const puts = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname}`;
      if (key === "GET /dev/v1/admin/script-languages") {
        return json(200, { items: [
          { code: "eng", name: "English", is_deleted: false },
          { code: "hin", name: "Hindi", is_deleted: false },
        ] });
      }
      if (key === "GET /dev/v1/admin/scripts") {
        expect(u.searchParams.get("place_id")).toBe("plc_AbCdEfGhIjKl");
        expect(u.searchParams.get("language")).toBe("eng");
        return json(200, { items: [
          { id: "scr_SkimSkimSkim", format: "skim", is_deleted: false, version: 2 },
        ], total: 1 });
      }
      if (key === "GET /dev/v1/admin/scripts/scr_SkimSkimSkim") {
        return json(200, { id: "scr_SkimSkimSkim", format: "skim", version: 2, content: "Welcome skim." });
      }
      if (key === "PUT /dev/v1/admin/scripts") {
        puts.push(JSON.parse(init.body));
        return json(200, { script: { id: "scr_SkimSkimSkim", version: 3, format: "skim" }, changed: true });
      }
      return json(404, { error: { code: "route_not_found", message: "missing" } });
    });
    const api = createApiClient({ bases: { media: "https://m.example/dev" }, getToken: async () => "tok", fetchImpl });
    const { node } = renderScriptsPanel({ api, kind: "place", id: "plc_AbCdEfGhIjKl" });
    root.append(node);
    await flush(10);
    expect(node.querySelector("h3").textContent).toBe("Narration scripts");
    expect(node.querySelector('select[aria-label="Script language"]').value).toBe("eng");
    expect(node.querySelector('#script-skim').value).toBe("Welcome skim.");
    expect(node.querySelector('#script-detailed').value).toBe("");
    expect(node.textContent).toContain("Version 2");
    expect(node.textContent).toContain("No script saved yet");

    node.querySelector("#script-skim").value = "Welcome skim updated.";
    [...node.querySelectorAll("button")].find((b) => b.textContent === "Save skim").click();
    await flush(6);
    expect(puts).toEqual([{ place_id: "plc_AbCdEfGhIjKl", language: "eng", format: "skim", content: "Welcome skim updated." }]);
    expect(node.querySelector('[role="status"]').textContent).toContain("Saved skim");
    expect(node.querySelector('[role="status"]').textContent).toContain("version 3");
  });

  it("saveScript uses spot_id for spots", async () => {
    const api = {
      put: vi.fn(async (_s, _p, body) => ({ script: body, changed: true })),
    };
    await saveScript(api, { kind: "spot", id: "spt_AbCdEfGhIjKl", language: "hin", format: "detailed", content: "Namaste" });
    expect(api.put).toHaveBeenCalledWith("media", "/v1/admin/scripts", {
      spot_id: "spt_AbCdEfGhIjKl", language: "hin", format: "detailed", content: "Namaste",
    });
  });

  it("loadScriptEditors skips deleted languages and missing formats", async () => {
    const api = {
      get: vi.fn(async (service, path, query) => {
        if (path === "/v1/admin/script-languages") {
          return { items: [
            { code: "eng", name: "English", is_deleted: false },
            { code: "xxx", name: "Gone", is_deleted: true },
          ] };
        }
        if (path === "/v1/admin/scripts") {
          expect(query.spot_id).toBe("spt_AbCdEfGhIjKl");
          return { items: [] };
        }
        throw new Error(`unexpected ${path}`);
      }),
    };
    const data = await loadScriptEditors(api, { kind: "spot", id: "spt_AbCdEfGhIjKl", language: "eng" });
    expect(data.languages.map((l) => l.code)).toEqual(["eng"]);
    expect(data.byFormat).toEqual({ skim: null, detailed: null });
  });
});
