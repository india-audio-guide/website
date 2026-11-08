const AUTH_CODE = /^auth\/[a-z0-9-]+$/;

/** Return a Firebase auth/* code only when it is a safe, well-formed string. */
export function safeAuthCode(err) {
  const code = err?.code;
  if (typeof code === "string" && AUTH_CODE.test(code)) return code;
  return null;
}

function guidanceForCode(code) {
  switch (code) {
    case "auth/captcha-check-failed":
      return "Firebase rejected the reCAPTCHA token (invalid, expired, already used, or from a domain that is not authorized). Complete the reCAPTCHA again. In the Firebase console, open Authentication → Settings → Authorized domains and add india-audio-guide.github.io for this project.";
    case "auth/invalid-app-credential":
      return "Firebase rejected the app verifier because the reCAPTCHA token was invalid or expired. Complete the reCAPTCHA again and retry. This is not the same as a domain-mismatch captcha error; if it keeps happening, confirm Phone sign-in is enabled and that india-audio-guide.github.io is authorized.";
    case "auth/missing-app-credential":
      return "Firebase did not receive a reCAPTCHA token. Reload the page, complete the reCAPTCHA checkbox, then send the code again.";
    case "auth/unauthorized-domain":
      return "This site's domain is not authorized for Firebase Auth. Add india-audio-guide.github.io under Authentication → Settings → Authorized domains.";
    case "auth/app-not-authorized":
      return "This site's domain is not allowed to use Firebase Authentication with the configured API key. Check Authorized domains and any HTTP referrer restrictions on the browser key.";
    case "auth/operation-not-allowed":
      return "Phone sign-in is disabled, or this request is not allowed for the project. Enable the Phone provider under Authentication → Sign-in method, and check Authentication → Settings → SMS region policy (new projects allow no regions until you add them, such as IN).";
    case "auth/quota-exceeded":
      return "This project's SMS quota has been exceeded. Wait and try again, or review Firebase Authentication limits.";
    case "auth/too-many-requests":
      return "Too many attempts from this device. Wait a bit and try again.";
    case "auth/invalid-phone-number":
    case "auth/missing-phone-number":
      return "Enter a valid phone number including country code, for example +91…";
    case "auth/invalid-verification-code":
      return "That code was not valid. Try again.";
    case "auth/code-expired":
    case "auth/session-expired":
      return "That code expired. Request a new one.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/invalid-api-key":
      return "The Firebase web API key for this environment was rejected. Check the public client key in the admin env map against the Firebase console.";
    case "auth/auth-domain-config-required":
      return "Firebase Auth is missing authDomain in the web config.";
    case "auth/argument-error":
      return "The sign-in request was not set up correctly. Reload the page and try again.";
    default:
      return "Something went wrong while signing in. Reload the page and try again.";
  }
}

/**
 * Human guidance plus the safe auth/* code. Never includes tokens, phone
 * numbers, or other fields from the raw Firebase error object.
 */
export function explainFirebaseError(err) {
  const code = safeAuthCode(err);
  const guidance = guidanceForCode(code);
  return code ? `${guidance} (${code})` : guidance;
}
