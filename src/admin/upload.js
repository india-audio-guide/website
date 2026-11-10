/** Spec 017 admin image flow: presign -> browser PUT to S3 -> complete, then poll while resizing. */
import { ApiError } from "./api.js";

export const IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 60000;

/** Returns an error message, or null when the file can be uploaded. */
export function validateImageFile(file) {
  if (!file) return "Choose an image file.";
  if (!IMAGE_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (!(file.size >= 1)) return "The file is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "The image must be 10 MB or smaller.";
  return null;
}

export class UploadError extends Error {
  constructor(step, cause) {
    const label = { presign: "Preparing the upload", upload: "Uploading to storage", complete: "Confirming the upload" }[step] ?? step;
    super(`${label} failed`);
    this.name = "UploadError";
    this.step = step;
    this.cause = cause;
  }
}

/**
 * Runs presign -> PUT -> complete in order and returns the completed image row.
 * The PUT goes to the presigned URL with exactly the returned headers and no Authorization.
 * `onStep(step)` is called before each step ("presign", "upload", "complete").
 */
export async function uploadImage({ api, fetchImpl = (...a) => globalThis.fetch(...a), putImpl, parentType, parentId, file, onStep = () => {}, onProgress }) {
  const invalid = validateImageFile(file);
  if (invalid) throw new UploadError("presign", new ApiError({ code: "invalid_file", message: invalid }));

  onStep("presign");
  let presign;
  try {
    presign = await api.post("media", "/v1/admin/images/presign", {
      parent_type: parentType,
      parent_id: parentId,
      content_type: file.type,
      bytes: file.size,
    });
  } catch (err) {
    throw new UploadError("presign", err);
  }
  if (!presign?.id || !presign?.upload_url) {
    throw new UploadError("presign", new ApiError({ code: "bad_response", message: "Presign response has no upload URL" }));
  }

  onStep("upload");
  let res;
  try {
    const headers = { ...(presign.headers ?? { "Content-Type": file.type }) };
    res = putImpl
      ? await putImpl(presign.upload_url, headers, file, onProgress)
      : await fetchImpl(presign.upload_url, { method: "PUT", headers, body: file });
  } catch {
    throw new UploadError("upload", new ApiError({ code: "network_error", message: "Network error" }));
  }
  if (!res.ok) {
    throw new UploadError("upload", new ApiError({ status: res.status, code: `s3_${res.status}`, message: `Storage rejected the upload (HTTP ${res.status})` }));
  }

  onStep("complete");
  try {
    return await api.post("media", `/v1/admin/images/${encodeURIComponent(presign.id)}/complete`);
  } catch (err) {
    throw new UploadError("complete", err);
  }
}

export const hasPending = (items) => (items ?? []).some((i) => i.status === "pending" && !i.is_deleted);

/**
 * Calls `list()` until no image is pending or `timeoutMs` passes. `onUpdate(items)` gets every result.
 * `isCancelled()` stops early (e.g. the gallery left the page). Returns `{ items, timedOut, cancelled }`.
 */
export async function pollImages({ list, onUpdate = () => {}, isCancelled = () => false, intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let items = await list();
  onUpdate(items);
  let waited = 0;
  while (hasPending(items)) {
    if (waited >= timeoutMs) return { items, timedOut: true, cancelled: false };
    await sleep(intervalMs);
    waited += intervalMs;
    if (isCancelled()) return { items, timedOut: false, cancelled: true };
    items = await list();
    if (isCancelled()) return { items, timedOut: false, cancelled: true };
    onUpdate(items);
  }
  return { items, timedOut: false, cancelled: false };
}

/**
 * New `ordered_ids` after moving image `id` by `delta` (-1 up, +1 down) among live images.
 * Returns null when the move is not possible. The API requires every live image exactly once.
 */
export function moveImage(items, id, delta) {
  const ids = (items ?? []).filter((i) => !i.is_deleted).map((i) => i.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/**
 * PUT with upload progress (XMLHttpRequest; fetch has no upload progress). Resolves `{ ok, status }`,
 * rejects on a network error. `onProgress(fraction)` gets 0..1. `Xhr` is injectable for tests.
 */
export function xhrPut(url, headers, body, onProgress, Xhr = globalThis.XMLHttpRequest) {
  return new Promise((resolve, reject) => {
    const xhr = new Xhr();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(body);
  });
}
