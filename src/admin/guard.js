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

/**
 * Match the Flutter app AuthState._e164:
 * strip non-digits; keep a leading +; 10 digits get +91; digits starting with 91 get +.
 */
export function normalizePhone(raw) {
  const trimmed = String(raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

export function isE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * National digits for the +91-prefixed field.
 * Pasting +9198… / 9198… / 98… keeps only the 10-digit national number in the input.
 */
export function nationalDigitsFromPhoneInput(raw) {
  const trimmed = String(raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 12 && digits.startsWith("91")) {
    return digits.slice(2, 12);
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

/** Same gate as the Flutter app: normalized E.164 shorter than 12 is too short. */
export function isPhoneTooShort(e164) {
  return String(e164 ?? "").length < 12;
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

/**
 * Whether the catalogue tools may mount: only for an admin decision, and only when the env has
 * API bases. Returns "mount", "not-configured" or "hide".
 */
export function toolsDecision(decision, envConfig) {
  if (decision?.state !== "admin") return "hide";
  return apiBasesConfigured(envConfig) ? "mount" : "not-configured";
}
