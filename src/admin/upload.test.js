import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { MAX_IMAGE_BYTES, UploadError, moveImage, pollImages, uploadImage, validateImageFile } from "./upload.js";

const ID = "img_AbCdEfGhIjKl";
const UPLOAD_URL = "https://iag-dev-assets-private.s3.ap-south-2.amazonaws.com/images/original/img_AbCdEfGhIjKl.jpg?X-Amz-Signature=sig";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const file = (type = "image/jpeg", size = 1234) => new File([new Uint8Array(size)], "photo", { type });

function setup(overrides = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push([init.method, url, init]);
    if (url.endsWith("/v1/admin/images/presign")) return overrides.presign?.() ?? json(201, { id: ID, upload_url: UPLOAD_URL, headers: { "Content-Type": "image/jpeg" }, max_bytes: MAX_IMAGE_BYTES, expires_in: 600 });
    if (url === UPLOAD_URL) return overrides.put?.() ?? new Response(null, { status: 200 });
    if (url.endsWith(`/v1/admin/images/${ID}/complete`)) return overrides.complete?.() ?? json(200, { id: ID, status: "pending", urls: null });
    throw new Error(`unexpected ${url}`);
  });
  const api = createApiClient({ bases: { media: "https://media.example/dev" }, getToken: async () => "tok", fetchImpl });
  return { api, fetchImpl, calls };
}

describe("image upload flow", () => {
  it("runs presign -> PUT -> complete in order with the right bodies and headers", async () => {
    const { api, fetchImpl, calls } = setup();
    const steps = [];
    const f = file();
    const out = await uploadImage({ api, fetchImpl, parentType: "place", parentId: "plc_AbCdEfGhIjKl", file: f, onStep: (s) => steps.push(s) });
    expect(out).toEqual({ id: ID, status: "pending", urls: null });
    expect(steps).toEqual(["presign", "upload", "complete"]);
    expect(calls.map(([m, u]) => `${m} ${u.replace(/\?.*/, "")}`)).toEqual([
      "POST https://media.example/dev/v1/admin/images/presign",
      "PUT https://iag-dev-assets-private.s3.ap-south-2.amazonaws.com/images/original/img_AbCdEfGhIjKl.jpg",
      `POST https://media.example/dev/v1/admin/images/${ID}/complete`,
    ]);
    expect(JSON.parse(calls[0][2].body)).toEqual({ parent_type: "place", parent_id: "plc_AbCdEfGhIjKl", content_type: "image/jpeg", bytes: 1234 });
    const put = calls[1][2];
    expect(put.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(put.headers.authorization).toBeUndefined();
    expect(put.body).toBe(f);
  });

  it("stops at the failing step and does not call complete after a rejected PUT", async () => {
    const { api, fetchImpl, calls } = setup({ put: () => new Response("<Error><Code>BadDigest</Code></Error>", { status: 400 }) });
    const err = await uploadImage({ api, fetchImpl, parentType: "spot", parentId: "spt_AbCdEfGhIjKl", file: file("image/png") }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.step).toBe("upload");
    expect(err.cause.code).toBe("s3_400");
    expect(calls).toHaveLength(2);
  });

  it("reports presign API errors with their code", async () => {
    const { api, fetchImpl, calls } = setup({ presign: () => json(404, { error: { code: "not_found", message: "Parent not found" } }) });
    const err = await uploadImage({ api, fetchImpl, parentType: "collection", parentId: "col_AbCdEfGhIjKl", file: file("image/webp") }).catch((e) => e);
    expect(err.step).toBe("presign");
    expect(err.cause.code).toBe("not_found");
    expect(calls).toHaveLength(1);
  });

  it("reports complete errors", async () => {
    const { api, fetchImpl } = setup({ complete: () => json(404, { error: { code: "not_found", message: "Upload not found" } }) });
    const err = await uploadImage({ api, fetchImpl, parentType: "place", parentId: "plc_AbCdEfGhIjKl", file: file() }).catch((e) => e);
    expect(err.step).toBe("complete");
  });

  it("validates type and size before any request", async () => {
    expect(validateImageFile(file("image/gif"))).toMatch(/JPEG, PNG or WebP/);
    expect(validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES + 1 })).toMatch(/10 MB/);
    expect(validateImageFile({ type: "image/jpeg", size: 0 })).toMatch(/empty/);
    expect(validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES })).toBeNull();
    const { api, fetchImpl } = setup();
    await expect(uploadImage({ api, fetchImpl, parentType: "place", parentId: "plc_AbCdEfGhIjKl", file: file("image/gif") })).rejects.toBeInstanceOf(UploadError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("processing poll", () => {
  it("polls until no image is pending", async () => {
    const results = [[{ id: "a", status: "pending" }], [{ id: "a", status: "pending" }], [{ id: "a", status: "ready" }]];
    const list = vi.fn(async () => results.shift());
    const sleep = vi.fn(async () => {});
    const out = await pollImages({ list, sleep, intervalMs: 3000, timeoutMs: 60000 });
    expect(out).toMatchObject({ timedOut: false, items: [{ status: "ready" }] });
    expect(list).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout and can be cancelled", async () => {
    const list = vi.fn(async () => [{ id: "a", status: "pending" }]);
    const out = await pollImages({ list, sleep: async () => {}, intervalMs: 3000, timeoutMs: 9000 });
    expect(out.timedOut).toBe(true);
    expect(list).toHaveBeenCalledTimes(4);
    let cancelled = false;
    const out2 = await pollImages({ list, sleep: async () => { cancelled = true; }, isCancelled: () => cancelled });
    expect(out2.cancelled).toBe(true);
  });
});

describe("reorder", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "x", is_deleted: true }, { id: "c" }];
  it("swaps among live images and lists each live id once", () => {
    expect(moveImage(items, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveImage(items, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveImage(items, "a", -1)).toBeNull();
    expect(moveImage(items, "x", 1)).toBeNull();
  });
});
