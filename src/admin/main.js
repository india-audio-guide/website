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

const phoneForm = document.getElementById("phone-form");
const codeForm = document.getElementById("code-form");
const checking = document.getElementById("checking");
const signedIn = document.getElementById("signed-in");
const signedInBody = document.getElementById("signed-in-body");
const signedInExtra = document.getElementById("signed-in-extra");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const envKicker = document.getElementById("env-kicker");
const sendBtn = document.getElementById("send-code");
const verifyBtn = document.getElementById("verify-code");
const signOutBtn = document.getElementById("sign-out");

let auth = null;
let envConfig = null;
let verifier = null;
let confirmation = null;
let generation = 0;
let view = "form";

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

function showError(message) {
  setText(errorEl, message);
  setText(statusEl, "");
}

function showStatus(message) {
  setText(statusEl, message);
  setText(errorEl, "");
}

function showView(next) {
  view = next;
  const isChecking = next === "checking";
  const isAdmin = next === "admin";
  checking.hidden = !isChecking;
  signedIn.hidden = !isAdmin;
  phoneForm.hidden = isChecking || isAdmin;
  if (isChecking || isAdmin) {
    codeForm.hidden = true;
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
    confirmation = null;
    if (view === "admin") {
      showView("form");
      showError(denialMessage("no-user"));
    } else if (view === "checking") {
      showView("form");
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
    showError(denialMessage("token-error"));
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
  showError(denialMessage(decision.reason));
}

async function start() {
  const requested = parseRequestedEnv(window.location.search);
  if (!requested.ok) {
    phoneForm.hidden = true;
    codeForm.hidden = true;
    showError(requested.error);
    return;
  }

  envConfig = ENVS[requested.env];
  envKicker.textContent = `Admin · ${envConfig.name}`;
  if (!firebaseConfigReady(envConfig)) {
    phoneForm.hidden = true;
    codeForm.hidden = true;
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

  onAuthStateChanged(auth, (user) => {
    void syncUser(user);
  });
  onIdTokenChanged(auth, (user) => {
    if (user) void syncUser(user);
  });
}

phoneForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth) return;
  const phone = normalizePhone(document.getElementById("phone").value);
  if (!isE164(phone)) {
    showError("Enter a valid phone number including country code, for example +91…");
    return;
  }
  sendBtn.disabled = true;
  showError("");
  showStatus("Sending a verification code…");
  try {
    clearVerifier();
    confirmation = await signInWithPhoneNumber(auth, phone, ensureVerifier());
    codeForm.hidden = false;
    showStatus("Enter the code sent to your phone.");
  } catch (err) {
    clearVerifier();
    confirmation = null;
    showError(explainFirebaseError(err));
  } finally {
    sendBtn.disabled = false;
  }
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!confirmation) {
    showError("Request a new code, then try again.");
    return;
  }
  const code = String(document.getElementById("code").value ?? "").trim();
  if (!code) {
    showError("Enter the SMS code.");
    return;
  }
  verifyBtn.disabled = true;
  showError("");
  showStatus("Verifying…");
  const pending = confirmation;
  try {
    await pending.confirm(code);
    confirmation = null;
  } catch (err) {
    if (auth?.currentUser && pending !== confirmation) {
      return;
    }
    showError(explainFirebaseError(err));
  } finally {
    verifyBtn.disabled = false;
  }
});

signOutBtn.addEventListener("click", async () => {
  const snapshot = nextGeneration();
  await safeSignOut();
  if (isStale(snapshot)) return;
  showView("form");
  showStatus("You have signed out.");
});

void start();
