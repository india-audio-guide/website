import { describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, createApiClient, formatApiError, parseErrorResponse } from "./api.js";

const bases = { content: "https://content.example/dev", media: "https://media.example/dev/" };
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("sends the ID token as a Bearer header, never in the URL", async () => {
    const fetchImpl = vi.fn(async () => json(200, { items: [], total: 0, limit: 25, offset: 0 }));
    const api = createApiClient({ bases, getToken: async () => "tok-123", fetchImpl });
    await api.get("content", "/v1/admin/places", { limit: 25, offset: 0, q: "", include_deleted: undefined });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://content.example/dev/v1/admin/places?limit=25&offset=0");
    expect(url).not.toContain("tok-123");
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe("Bearer tok-123");
    expect(init.headers["content-type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("sends JSON bodies with content-type and strips a trailing base slash", async () => {
    const fetchImpl = vi.fn(async () => json(201, { id: "img_abcdefghijkl" }));
    const api = createApiClient({ bases, getToken: async () => "t", fetchImpl });
    const out = await api.post("media", "/v1/admin/images/presign", { a: 1 });
    expect(out).toEqual({ id: "img_abcdefghijkl" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://media.example/dev/v1/admin/images/presign");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it("returns null for 204", async () => {
    const api = createApiClient({ bases, getToken: async () => "t", fetchImpl: async () => new Response(null, { status: 204 }) });
    expect(await api.del("content", "/v1/admin/places/plc_x")).toBeNull();
  });

  it("parses the API error envelope with code, message and details", async () => {
    const fetchImpl = async () => json(400, { error: { code: "validation_error", message: "Invalid request", details: [{ path: "slug", message: "Lower-case words joined by -" }] } });
    const api = createApiClient({ bases, getToken: async () => "t", fetchImpl });
    const err = await api.post("content", "/v1/admin/places", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(formatApiError(err)).toBe("Invalid request (validation_error): slug: Lower-case words joined by -");
  });

  it("maps non-JSON and gateway errors, and network failures", async () => {
    expect((await parseErrorResponse(new Response("<html>", { status: 502 }))).code).toBe("http_502");
    const gw = await parseErrorResponse(json(403, { message: "Forbidden" }));
    expect(formatApiError(gw)).toBe("Forbidden (http_403)");
    const api = createApiClient({ bases, getToken: async () => "t", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    const err = await api.get("content", "/v1/admin/places").catch((e) => e);
    expect(err.code).toBe("network_error");
    expect(formatApiError(err)).toContain("CORS");
  });

  it("retries a 401 once with a forced token refresh", async () => {
    const getToken = vi.fn(async (force) => (force ? "fresh" : "stale"));
    const fetchImpl = vi.fn(async (_u, init) => (init.headers.authorization === "Bearer fresh" ? json(200, { ok: true }) : json(401, { error: { code: "unauthorized", message: "Invalid or expired token" } })));
    const api = createApiClient({ bases, getToken, fetchImpl });
    expect(await api.get("content", "/v1/admin/places")).toEqual({ ok: true });
    expect(getToken.mock.calls.map((c) => Boolean(c[0]))).toEqual([false, true]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not call fetch without a token or without a configured base", async () => {
    const fetchImpl = vi.fn();
    const signedOut = createApiClient({ bases, getToken: async () => null, fetchImpl });
    expect((await signedOut.get("content", "/v1/admin/places").catch((e) => e)).code).toBe("signed_out");
    const prod = createApiClient({ bases: { content: "", media: "" }, getToken: async () => "t", fetchImpl });
    expect((await prod.get("content", "/v1/admin/places").catch((e) => e)).code).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("buildUrl encodes query values", () => {
    expect(buildUrl("https://x.example/dev", "/v1/admin/places", { q: "a b&c", published: false })).toBe("https://x.example/dev/v1/admin/places?q=a+b%26c&published=false");
  });
});
