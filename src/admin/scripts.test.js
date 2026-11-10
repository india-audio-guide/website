// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { loadScriptEditors, saveScript, scriptTargetQuery } from "./scripts.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe("script helpers", () => {
  it("builds place_id or spot_id target queries", () => {
    expect(scriptTargetQuery("place", "plc_AbCdEfGhIjKl")).toEqual({ place_id: "plc_AbCdEfGhIjKl" });
    expect(scriptTargetQuery("spot", "spt_AbCdEfGhIjKl")).toEqual({ spot_id: "spt_AbCdEfGhIjKl" });
    expect(() => scriptTargetQuery("collection", "col_x")).toThrow(/place or spot/);
  });
});

describe("narration script api helpers", () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="r"></div>';
    root = document.getElementById("r");
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
