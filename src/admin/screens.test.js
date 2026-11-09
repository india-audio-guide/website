// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { mountAdminTools } from "./screens.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const PLACE = { id: "plc_AbCdEfGhIjKl", state_id: "ste_AbCdEfGhIjKl", slug: "hampi", name: "Hampi", city: "Hosapete", summary: null, cover: null, latitude: 15.3, longitude: 76.4, skim_minutes: 30, detailed_minutes: null, published: false, is_deleted: false };

function client(routes) {
  const fetchImpl = vi.fn(async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    const handler = routes[key];
    if (!handler) return json(404, { error: { code: "route_not_found", message: "Route not found" } });
    return handler(u, init);
  });
  return { api: createApiClient({ bases: { content: "https://c.example/dev", media: "https://m.example/dev" }, getToken: async () => "tok", fetchImpl }), fetchImpl };
}

describe("catalogue screens", () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<section id="t" hidden></section>';
    root = document.getElementById("t");
  });

  it("lists places with pagination info and shows API errors with their code", async () => {
    const { api, fetchImpl } = client({
      "GET /dev/v1/admin/places": (u) => (u.searchParams.get("q") === "boom"
        ? json(403, { error: { code: "forbidden", message: "Requires the admin role" } })
        : json(200, { items: [PLACE], total: 30, limit: 25, offset: 0 })),
    });
    const tools = mountAdminTools(root, { api });
    await flush();
    expect(root.hidden).toBe(false);
    expect(root.querySelector("tbody").textContent).toContain("Hampi");
    expect(root.querySelector(".pager").textContent).toContain("1–1 of 30");
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("limit")).toBe("25");

    root.querySelector('input[type="search"]').value = "boom";
    root.querySelector("form.toolbar").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(root.querySelector('[role="alert"]').textContent).toBe("Requires the admin role (forbidden)");

    tools.unmount();
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it("opens a place, saves only changed fields, and publishes", async () => {
    const patches = [];
    const { api } = client({
      "GET /dev/v1/admin/places": () => json(200, { items: [PLACE], total: 1, limit: 25, offset: 0 }),
      "GET /dev/v1/admin/states": () => json(200, { items: [{ id: PLACE.state_id, name: "Karnataka", code: "KA" }] }),
      [`GET /dev/v1/admin/places/${PLACE.id}`]: () => json(200, PLACE),
      [`PATCH /dev/v1/admin/places/${PLACE.id}`]: (_u, init) => { patches.push(JSON.parse(init.body)); return json(200, { ...PLACE, ...JSON.parse(init.body) }); },
      [`POST /dev/v1/admin/places/${PLACE.id}/publish`]: () => json(200, { ...PLACE, published: true }),
      [`GET /dev/v1/admin/places/${PLACE.id}/spots`]: () => json(200, { items: [], total: 0, limit: 0, offset: 0 }),
      "GET /dev/v1/admin/images": () => json(200, { items: [
        { id: "img_AAAAAAAAAAAA", status: "ready", urls: { 320: "https://cdn.example/images/img_AAAAAAAAAAAA/320.webp" } },
        { id: "img_BBBBBBBBBBBB", status: "pending", urls: null },
      ] }),
    });
    mountAdminTools(root, { api, sleep: () => new Promise(() => {}) });
    await flush();
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Open").click();
    await flush(8);
    expect(root.querySelector("h2").textContent).toBe("Place: Hampi");
    expect(root.querySelector("#f-state_id").value).toBe(PLACE.state_id);
    root.querySelector("#f-city").value = "";
    root.querySelector("form.entity-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(patches).toEqual([{ city: null }]);
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish").click();
    await flush();
    expect(root.querySelector(".meta").textContent).toContain("published");
    expect([...root.querySelectorAll("h3")].map((x) => x.textContent)).toEqual(["Images", "Spots"]);
    const cards = [...root.querySelectorAll(".image-card")];
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector("img").getAttribute("src")).toBe("https://cdn.example/images/img_AAAAAAAAAAAA/320.webp");
    expect(cards[0].textContent).toContain("Set cover");
    expect(cards[1].textContent).toContain("processing");
    expect(cards[1].textContent).not.toContain("Set cover");
    expect(root.querySelector(".gallery").textContent).not.toContain("null");
  });
});
