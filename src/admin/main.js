import {
  RecaptchaVerifier,
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  onIdTokenChanged,
  setPersistence,
  signInWithPhoneNumber,
  signOut,
} from "firebase/auth";
import { initializeApp } from "firebase/app";
import { ENVS } from "./config.js";
import {
  denialMessage,
  evaluateAuthEvent,
  firebaseConfigReady,
  isPhoneTooShort,
  nationalDigitsFromPhoneInput,
  normalizePhone,
  parseRequestedEnv,
  toolsDecision,
} from "./guard.js";
import {
  initialLoginForm,
  loginFormView,
  reduceLoginForm,
  submitIntent,
} from "./loginForm.js";
import { explainFirebaseError } from "./errors.js";
import { createApiClient } from "./api.js";
import { mountAdminTools } from "./screens.js";
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  syncThemeToggleButton,
  systemPrefersDark,
  writeStoredTheme,
} from "./theme.js";

const loginForm = document.getElementById("login-form");
const codeField = document.getElementById("code-field");
const phoneInput = document.getElementById("phone");
const codeInput = document.getElementById("code");
const primaryBtn = document.getElementById("primary-action");
const changeNumberBtn = document.getElementById("change-number");
const checking = document.getElementById("checking");
const signedIn = document.getElementById("signed-in");
const signedInBody = document.getElementById("signed-in-body");
const signedInExtra = document.getElementById("signed-in-extra");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const envKicker = document.getElementById("env-kicker");
const pageTitle = document.getElementById("page-title");
const intro = document.getElementById("intro");
const headerSignOutBtn = document.getElementById("header-sign-out");
const themeToggleBtn = document.getElementById("theme-toggle");
const adminLogo = document.getElementById("admin-logo");
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
const toolsRoot = document.getElementById("admin-tools");
const adminMain = document.getElementById("admin-main");

const TITLE_SIGN_IN = "Admin sign in · India Audio Guide";
const TITLE_ADMIN = "Admin · India Audio Guide";

const colorSchemeQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : { matches: false, addEventListener() {}, addListener() {} };

function refreshTheme(stored = readStoredTheme(window.localStorage)) {
  const result = applyTheme({
    stored,
    prefersDark: systemPrefersDark(colorSchemeQuery),
    root: document.documentElement,
    metaThemeColor,
    logo: adminLogo,
  });
  syncThemeToggleButton(themeToggleBtn, result.resolved);
  return result;
}

let auth = null;
let envConfig = null;
let verifier = null;
let confirmation = null;
let generation = 0;
// Start neutral: the login form stays hidden until the first auth event resolves.
let view = "checking";
let formState = initialLoginForm();
let tools = null;

function unmountTools() {
  tools?.unmount();
  tools = null;
  if (toolsRoot) {
    toolsRoot.replaceChildren();
    toolsRoot.hidden = true;
  }
  adminMain?.classList.remove("admin-wide");
}

function mountTools() {
  if (tools) return;
  const api = createApiClient({
    bases: envConfig.apis,
    getToken: (forceRefresh) =>
      auth?.currentUser ? auth.currentUser.getIdToken(Boolean(forceRefresh)) : Promise.resolve(null),
  });
  adminMain?.classList.add("admin-wide");
  tools = mountAdminTools(toolsRoot, { api });
}

function nextGeneration() {
  generation += 1;
  return generation;
}

function isStale(snapshot) {
  return snapshot !== generation;
}

function setText(el, text) {
  if (!el) return;
  if (text) {
    el.hidden = false;
    el.textContent = text;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function dispatchForm(action) {
  formState = reduceLoginForm(formState, action);
  const ui = loginFormView(formState);
  primaryBtn.textContent = ui.buttonLabel;
  primaryBtn.disabled = ui.buttonDisabled;
  codeField.hidden = !ui.showCode;
  phoneInput.readOnly = ui.phoneLocked;
  changeNumberBtn.hidden = !ui.showChangeNumber;
  setText(statusEl, ui.status);
  setText(errorEl, ui.error);
  if (ui.showCode) {
    codeInput.focus();
  }
}

function explainAndStay(actionType, err) {
  dispatchForm({ type: actionType, error: explainFirebaseError(err) });
}

function showError(message) {
  setText(errorEl, message);
  setText(statusEl, "");
}

function showStatus(message) {
  setText(statusEl, message);
  setText(errorEl, "");
}

function resetLoginForm(action = { type: "reset" }) {
  confirmation = null;
  clearVerifier();
  if (codeInput) codeInput.value = "";
  dispatchForm(action);
}

function showView(next) {
  view = next;
  const isChecking = next === "checking";
  const isAdmin = next === "admin";
  // "blocked": config or persistence error; only the error banner shows.
  const isBlocked = next === "blocked";
  if (!isAdmin) unmountTools();
  checking.hidden = !isChecking;
  signedIn.hidden = !isAdmin;
  loginForm.hidden = isChecking || isAdmin || isBlocked;
  if (intro) intro.hidden = isChecking || isAdmin || isBlocked;
  if (pageTitle) {
    pageTitle.hidden = isChecking;
    pageTitle.textContent = isAdmin ? "Admin" : "Sign in";
  }
  document.title = isAdmin ? TITLE_ADMIN : TITLE_SIGN_IN;
  if (headerSignOutBtn) headerSignOutBtn.hidden = !isAdmin;
  if (isAdmin) {
    setText(statusEl, "");
    setText(errorEl, "");
    confirmation = null;
    clearVerifier();
  }
  if (isChecking || isAdmin) {
    changeNumberBtn.hidden = true;
  }
}

async function handleSignOutClick() {
  const snapshot = nextGeneration();
  await safeSignOut();
  if (isStale(snapshot)) return;
  showView("form");
  resetLoginForm({ type: "reset", status: "You have signed out." });
}

async function safeSignOut() {
  if (!auth?.currentUser) return;
  try {
    await signOut(auth);
  } catch {
    // Fail closed: the UI already hides protected content.
  }
}

function clearVerifier() {
  try {
    verifier?.clear();
  } catch {
    // Recaptcha may already have been removed from the DOM.
  }
  verifier = null;
}

function ensureVerifier() {
  if (verifier) return verifier;
  verifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "normal",
  });
  return verifier;
}

async function syncUser(user) {
  const snapshot = nextGeneration();
  if (!user) {
    if (view === "admin") {
      showView("form");
      resetLoginForm({ type: "reset", error: denialMessage("no-user") });
    } else if (view === "checking") {
      showView("form");
      resetLoginForm();
    }
    return;
  }

  if (view !== "admin") {
    showView("checking");
    showStatus("");
    showError("");
  }

  let tokenResult;
  try {
    tokenResult = await user.getIdTokenResult(true);
  } catch {
    if (isStale(snapshot)) return;
    await safeSignOut();
    if (isStale(snapshot)) return;
    showView("form");
    resetLoginForm({ type: "reset", error: denialMessage("token-error") });
    return;
  }
  if (isStale(snapshot)) return;

  const decision = evaluateAuthEvent({ user, tokenResult });
  if (decision.state === "admin") {
    const phone = user.phoneNumber ? ` (${user.phoneNumber})` : "";
    signedInBody.textContent = `You are signed in as an admin on ${envConfig.name}${phone}.`;
    const toolsState = toolsDecision(decision, envConfig);
    signedInExtra.textContent =
      toolsState === "mount"
        ? "Manage places, spots, collections and images below."
        : "Admin APIs are not configured for this environment, so this page will not call them.";
    showView("admin");
    if (toolsState === "mount") mountTools();
    else unmountTools();
    showStatus("");
    showError("");
    return;
  }

  await safeSignOut();
  if (isStale(snapshot)) return;
  showView("form");
  resetLoginForm({ type: "reset", error: denialMessage(decision.reason) });
}

function syncPhoneInputValue() {
  if (!phoneInput) return;
  const next = nationalDigitsFromPhoneInput(phoneInput.value);
  if (phoneInput.value !== next) {
    phoneInput.value = next;
  }
}

async function sendCode() {
  syncPhoneInputValue();
  const phone = normalizePhone(phoneInput.value);
  if (isPhoneTooShort(phone)) {
    dispatchForm({
      type: "validate",
      error: "Enter a mobile number.",
    });
    return;
  }
  dispatchForm({ type: "send-start" });
  try {
    clearVerifier();
    confirmation = await signInWithPhoneNumber(auth, phone, ensureVerifier());
    dispatchForm({ type: "send-success" });
  } catch (err) {
    confirmation = null;
    clearVerifier();
    explainAndStay("send-failure", err);
  }
}

async function verifyCode() {
  if (!confirmation) {
    dispatchForm({
      type: "verify-failure",
      error: "Request a new code, then try again.",
    });
    return;
  }
  const code = String(codeInput.value ?? "").trim();
  if (!code) {
    dispatchForm({ type: "validate", error: "Enter the SMS code." });
    return;
  }
  dispatchForm({ type: "verify-start" });
  const pending = confirmation;
  try {
    await pending.confirm(code);
    confirmation = null;
    dispatchForm({ type: "verify-success" });
  } catch (err) {
    if (auth?.currentUser && pending !== confirmation) {
      return;
    }
    explainAndStay("verify-failure", err);
  }
}

async function start() {
  const requested = parseRequestedEnv(window.location.search);
  if (!requested.ok) {
    showView("blocked");
    showError(requested.error);
    return;
  }

  envConfig = ENVS[requested.env];
  envKicker.textContent = `Admin · ${envConfig.name}`;
  if (!firebaseConfigReady(envConfig)) {
    showView("blocked");
    showError("This environment's public Firebase config is incomplete.");
    return;
  }

  const app = initializeApp(envConfig.firebase, `iag-${envConfig.name}`);
  auth = getAuth(app);
  try {
    await setPersistence(auth, browserSessionPersistence);
  } catch {
    showView("blocked");
    showError(
      "Could not set a session-only sign-in. Reload the page and try again.",
    );
    return;
  }

  dispatchForm({ type: "reset" });

  onAuthStateChanged(auth, (user) => {
    void syncUser(user);
  });
  onIdTokenChanged(auth, (user) => {
    if (user) void syncUser(user);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth) return;
  const intent = submitIntent(formState);
  if (intent.type === "send") {
    await sendCode();
    return;
  }
  if (intent.type === "verify") {
    await verifyCode();
  }
});

changeNumberBtn.addEventListener("click", () => {
  resetLoginForm();
  phoneInput.focus();
});

phoneInput?.addEventListener("input", () => {
  syncPhoneInputValue();
});

phoneInput?.addEventListener("paste", () => {
  // Let the paste land, then strip +91 / 91 from the editable value.
  queueMicrotask(() => syncPhoneInputValue());
});

headerSignOutBtn?.addEventListener("click", () => {
  void handleSignOutClick();
});

themeToggleBtn?.addEventListener("click", () => {
  const current = refreshTheme().resolved;
  const chosen = nextTheme(current);
  writeStoredTheme(window.localStorage, chosen);
  refreshTheme(chosen);
});

function watchSystemTheme() {
  const onChange = () => {
    // Only re-apply when the user has not chosen; stored choice still wins.
    if (readStoredTheme(window.localStorage)) return;
    refreshTheme(null);
  };
  if (typeof colorSchemeQuery.addEventListener === "function") {
    colorSchemeQuery.addEventListener("change", onChange);
  } else if (typeof colorSchemeQuery.addListener === "function") {
    colorSchemeQuery.addListener(onChange);
  }
}

refreshTheme();
watchSystemTheme();
void start();
