/** Admin means role 10 in users_role_check / iag-auth ROLES. Higher integers stay admin. */
export const ADMIN_MIN_ROLE = 10;

const ALLOWED_ENVS = new Set(["dev", "prod"]);

/**
 * Read ?env= from a query string. Default is dev.
 * Unknown values fail closed so we never point prod at dev Firebase or APIs.
 */
export function parseRequestedEnv(search) {
  const params = new URLSearchParams(
    typeof search === "string" ? search.replace(/^\?/, "") : String(search ?? ""),
  );
  const raw = params.get("env");
  if (raw == null || raw === "") {
    return { ok: true, env: "dev", explicit: false };
  }
  if (ALLOWED_ENVS.has(raw)) {
    return { ok: true, env: raw, explicit: true };
  }
  return {
    ok: false,
    env: null,
    explicit: true,
    error: "Unknown environment. Use ?env=dev or ?env=prod.",
  };
}

export function apiBasesConfigured(envConfig) {
  if (!envConfig?.apis) return false;
  const { user, content, media, payment } = envConfig.apis;
  return Boolean(user && content && media && payment);
}

export function firebaseConfigReady(envConfig) {
  const fb = envConfig?.firebase;
  return Boolean(fb?.apiKey && fb?.authDomain && fb?.projectId);
}

/** 10-digit numbers get +91, matching the admin CLI. */
export function normalizePhone(raw) {
  const v = String(raw ?? "").trim();
  if (/^\d{10}$/.test(v)) return `+91${v}`;
  if (v.startsWith("+")) return v;
  if (/^\d+$/.test(v)) return `+${v}`;
  return v;
}

export function isE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * Fail closed unless role is an integer >= ADMIN_MIN_ROLE.
 * String "10" and other shapes are malformed, not coerced.
 */
export function evaluateAdminClaims(claims) {
  if (claims == null || typeof claims !== "object") {
    return { allowed: false, reason: "missing-claims" };
  }
  if (!Object.prototype.hasOwnProperty.call(claims, "role")) {
    return { allowed: false, reason: "missing-role" };
  }
  const { role } = claims;
  if (role == null) {
    return { allowed: false, reason: "missing-role" };
  }
  if (typeof role !== "number" || !Number.isInteger(role)) {
    return { allowed: false, reason: "malformed-role" };
  }
  if (role < ADMIN_MIN_ROLE) {
    return { allowed: false, reason: "insufficient-role", role };
  }
  return { allowed: true, reason: "admin", role };
}

/**
 * Decide what the UI should do after an auth or token event.
 * tokenError or a failed claim check requires sign-out.
 */
export function evaluateAuthEvent({ user, tokenResult, tokenError } = {}) {
  if (!user) {
    return { state: "signed-out", reason: "no-user" };
  }
  if (tokenError) {
    return { state: "sign-out-required", reason: "token-error" };
  }
  if (!tokenResult) {
    return { state: "checking", reason: "awaiting-token" };
  }
  const decision = evaluateAdminClaims(tokenResult.claims);
  if (!decision.allowed) {
    return { state: "sign-out-required", ...decision };
  }
  return { state: "admin", ...decision };
}

export function denialMessage(reason) {
  switch (reason) {
    case "missing-claims":
    case "missing-role":
    case "malformed-role":
    case "insufficient-role":
      return "You're not authorized to use admin tools.";
    case "token-error":
      return "Could not verify your access. You have been signed out.";
    case "no-user":
      return "Your session ended. Sign in again.";
    default:
      return "You're not authorized to use admin tools.";
  }
}
