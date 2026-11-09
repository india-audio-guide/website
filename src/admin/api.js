/** Admin API client (docs store-listing 001, catalogue screens).
 * Every call sends `Authorization: Bearer <Firebase ID token>`. The token never
 * goes in a URL, the DOM or logs. On a 401 the client retries once with a
 * forced token refresh.
 */

export class ApiError extends Error {
  constructor({ status = 0, code, message, details } = {}) {
    super(message || code || "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = code || (status ? `http_${status}` : "network_error");
    this.details = Array.isArray(details) ? details : [];
  }
}

/** Joins an API base and path, adding query params (skips undefined, null and ""). */
export function buildUrl(base, path, query) {
  const root = String(base || "").replace(/\/+$/, "");
  const url = new URL(`${root}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Turns a non-2xx Response into an ApiError, reading the `{ error: { code, message, details } }` envelope. */
export async function parseErrorResponse(res) {
  let payload = null;
  try {
    const text = await res.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const err = payload && typeof payload === "object" ? payload.error : null;
  if (err && typeof err === "object") {
    return new ApiError({
      status: res.status,
      code: typeof err.code === "string" ? err.code : undefined,
      message: typeof err.message === "string" ? err.message : undefined,
      details: err.details,
    });
  }
  if (payload && typeof payload.message === "string") {
    // API Gateway's own errors, e.g. {"message":"Not Found"}.
    return new ApiError({ status: res.status, message: payload.message });
  }
  return new ApiError({ status: res.status, message: `HTTP ${res.status}` });
}

/** One readable line: `message (code)` plus `path: message` for each detail. */
export function formatApiError(err) {
  if (!err) return "";
  if (err instanceof ApiError) {
    const head = err.code === "network_error"
      ? "Could not reach the API (network or CORS problem). Check your connection and try again. (network_error)"
      : `${err.message} (${err.code})`;
    const details = err.details
      .map((d) => (d && typeof d === "object" ? `${d.path ? `${d.path}: ` : ""}${d.message ?? ""}` : String(d)))
      .filter(Boolean);
    return details.length ? `${head}: ${details.join("; ")}` : head;
  }
  return err.message || String(err);
}

/**
 * `bases` is the env `apis` map (content, media, ...). `getToken(forceRefresh)` returns the
 * current user's ID token. `fetchImpl` is injectable for tests.
 */
export function createApiClient({ bases, getToken, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  async function send(service, method, path, { query, body } = {}, forceRefresh = false) {
    const base = bases?.[service];
    if (!base) throw new ApiError({ code: "not_configured", message: `The ${service} API is not configured for this environment` });
    let token;
    try {
      token = await getToken(forceRefresh);
    } catch {
      token = null;
    }
    if (!token) throw new ApiError({ status: 401, code: "signed_out", message: "Sign in again to continue" });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
    const init = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(buildUrl(base, path, query), init);
    } catch {
      throw new ApiError({ code: "network_error", message: "Network error" });
    }
    return res;
  }

  async function request(service, method, path, options = {}) {
    let res = await send(service, method, path, options);
    if (res.status === 401) res = await send(service, method, path, options, true);
    if (!res.ok) throw await parseErrorResponse(res);
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError({ status: res.status, code: "bad_response", message: "The API returned invalid JSON" });
    }
  }

  return {
    request,
    get: (service, path, query) => request(service, "GET", path, { query }),
    post: (service, path, body) => request(service, "POST", path, { body }),
    patch: (service, path, body) => request(service, "PATCH", path, { body }),
    put: (service, path, body) => request(service, "PUT", path, { body }),
    del: (service, path) => request(service, "DELETE", path),
  };
}
