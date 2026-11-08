import { describe, expect, it } from "vitest";
import {
  initialLoginForm,
  loginFormView,
  reduceLoginForm,
  submitIntent,
} from "./loginForm.js";

function viewAfter(actions, start = initialLoginForm()) {
  const state = actions.reduce((s, action) => reduceLoginForm(s, action), start);
  return { state, view: loginFormView(state) };
}

describe("single primary login button", () => {
  it("starts on phone entry with Send code and no code field", () => {
    const view = loginFormView(initialLoginForm());
    expect(view.buttonLabel).toBe("Send code");
    expect(view.buttonDisabled).toBe(false);
    expect(view.showCode).toBe(false);
    expect(view.phoneLocked).toBe(false);
    expect(view.showChangeNumber).toBe(false);
    expect(submitIntent(initialLoginForm())).toEqual({ type: "send" });
  });

  it("shows Sending… and ignores extra submits while sending", () => {
    const { view, state } = viewAfter([{ type: "send-start" }]);
    expect(view.buttonLabel).toBe("Sending…");
    expect(view.buttonDisabled).toBe(true);
    expect(view.showCode).toBe(false);
    expect(view.stage).toBe("phone");
    expect(state.status).toMatch(/Sending/);
    expect(submitIntent(state)).toEqual({ type: "ignore" });
  });

  it("becomes Verify only after a successful send", () => {
    const { view, state } = viewAfter([
      { type: "send-start" },
      { type: "send-success" },
    ]);
    expect(view.buttonLabel).toBe("Verify");
    expect(view.buttonDisabled).toBe(false);
    expect(view.showCode).toBe(true);
    expect(view.phoneLocked).toBe(true);
    expect(view.showChangeNumber).toBe(true);
    expect(state.status).toMatch(/Enter the code/);
    expect(submitIntent(state)).toEqual({ type: "verify" });
  });

  it("stays on Send code after a send failure so the user can retry", () => {
    const { view, state } = viewAfter([
      { type: "send-start" },
      { type: "send-failure", error: "Network error. Check your connection and try again." },
    ]);
    expect(view.buttonLabel).toBe("Send code");
    expect(view.buttonDisabled).toBe(false);
    expect(view.showCode).toBe(false);
    expect(view.showChangeNumber).toBe(false);
    expect(state.error).toMatch(/Network error/);
    expect(state.status).toBe("");
    expect(submitIntent(state)).toEqual({ type: "send" });
  });

  it("does not advance to Verify on a phone validation error", () => {
    const { view, state } = viewAfter([
      { type: "validate", error: "Enter a valid phone number including country code, for example +91…" },
    ]);
    expect(view.buttonLabel).toBe("Send code");
    expect(view.showCode).toBe(false);
    expect(state.error).toMatch(/valid phone number/);
  });

  it("shows Verifying… then keeps Verify after a failed attempt", () => {
    const started = viewAfter([
      { type: "send-success" },
      { type: "verify-start" },
    ]);
    expect(started.view.buttonLabel).toBe("Verifying…");
    expect(started.view.buttonDisabled).toBe(true);
    expect(started.view.showCode).toBe(true);
    expect(started.view.showChangeNumber).toBe(false);
    expect(submitIntent(started.state)).toEqual({ type: "ignore" });

    const failed = viewAfter(
      [{ type: "verify-failure", error: "That code was not valid. Try again." }],
      started.state,
    );
    expect(failed.view.buttonLabel).toBe("Verify");
    expect(failed.view.buttonDisabled).toBe(false);
    expect(failed.view.showCode).toBe(true);
    expect(failed.view.showChangeNumber).toBe(true);
    expect(failed.state.error).toMatch(/not valid/);
    expect(submitIntent(failed.state)).toEqual({ type: "verify" });
  });

  it("does not leave the code stage on an empty-code validation error", () => {
    const { view, state } = viewAfter([
      { type: "send-success" },
      { type: "validate", error: "Enter the SMS code." },
    ]);
    expect(view.buttonLabel).toBe("Verify");
    expect(view.showCode).toBe(true);
    expect(state.error).toMatch(/SMS code/);
  });

  it("resets to Send code when the user changes number", () => {
    const { view, state } = viewAfter([
      { type: "send-success" },
      { type: "verify-failure", error: "That code expired. Request a new one." },
      { type: "reset" },
    ]);
    expect(view.buttonLabel).toBe("Send code");
    expect(view.showCode).toBe(false);
    expect(view.phoneLocked).toBe(false);
    expect(view.showChangeNumber).toBe(false);
    expect(state.error).toBe("");
    expect(submitIntent(state)).toEqual({ type: "send" });
  });
});
