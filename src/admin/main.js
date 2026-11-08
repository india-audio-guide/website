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
  apiBasesConfigured,
  denialMessage,
  evaluateAuthEvent,
  firebaseConfigReady,
  isE164,
  normalizePhone,
  parseRequestedEnv,
} from "./guard.js";
import {
  initialLoginForm,
  loginFormView,
  reduceLoginForm,
  submitIntent,
} from "./loginForm.js";

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
const signOutBtn = document.getElementById("sign-out");

let auth = null;
let envConfig = null;
let verifier = null;
let confirmation = null;
let generation = 0;
let view = "form";
let formState = initialLoginForm();

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

function explainFirebaseError(err) {
  switch (err?.code) {
    case "auth/unauthorized-domain":
      return "This site is not listed as an authorized domain in Firebase Auth. Add india-audio-guide.github.io for this project, then try again.";
    case "auth/operation-not-allowed":
      return "Phone sign-in is not enabled for this Firebase project.";
    case "auth/invalid-phone-number":
    case "auth/missing-phone-number":
      return "Enter a valid phone number including country code, for example +91…";
    case "auth/invalid-verification-code":
      return "That code was not valid. Try again.";
    case "auth/code-expired":
    case "auth/session-expired":
      return "That code expired. Request a new one.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a bit and try again.";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
      return "The reCAPTCHA check failed. Reload the page and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Something went wrong while signing in. Reload the page and try again.";
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
  checking.hidden = !isChecking;
  signedIn.hidden = !isAdmin;
  loginForm.hidden = isChecking || isAdmin;
  if (isChecking || isAdmin) {
    changeNumberBtn.hidden = true;
  }
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
    signedInExtra.textContent = apiBasesConfigured(envConfig)
      ? "Admin tools are not on this page yet."
      : "Admin API addresses are not configured for this environment yet, so this page will not call them.";
    showView("admin");
    showStatus("");
    showError("");
    return;
  }

  await safeSignOut();
  if (isStale(snapshot)) return;
  showView("form");
  resetLoginForm({ type: "reset", error: denialMessage(decision.reason) });
}

async function sendCode() {
  const phone = normalizePhone(phoneInput.value);
  if (!isE164(phone)) {
    dispatchForm({
      type: "validate",
      error: "Enter a valid phone number including country code, for example +91…",
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
    loginForm.hidden = true;
    showError(requested.error);
    return;
  }

  envConfig = ENVS[requested.env];
  envKicker.textContent = `Admin · ${envConfig.name}`;
  if (!firebaseConfigReady(envConfig)) {
    loginForm.hidden = true;
    showError("This environment's public Firebase config is incomplete.");
    return;
  }

  const app = initializeApp(envConfig.firebase, `iag-${envConfig.name}`);
  auth = getAuth(app);
  try {
    await setPersistence(auth, browserSessionPersistence);
  } catch {
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

signOutBtn.addEventListener("click", async () => {
  const snapshot = nextGeneration();
  await safeSignOut();
  if (isStale(snapshot)) return;
  showView("form");
  resetLoginForm({ type: "reset", status: "You have signed out." });
});

void start();
