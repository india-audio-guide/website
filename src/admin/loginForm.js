export const LOGIN_STAGE = {
  phone: "phone",
  code: "code",
};

export function initialLoginForm() {
  return {
    stage: LOGIN_STAGE.phone,
    busy: false,
    error: "",
    status: "",
  };
}

export function loginFormView(state) {
  const busy = Boolean(state?.busy);
  const stage = state?.stage === LOGIN_STAGE.code ? LOGIN_STAGE.code : LOGIN_STAGE.phone;
  let buttonLabel = "Send code";
  if (stage === LOGIN_STAGE.code) {
    buttonLabel = busy ? "Verifying…" : "Verify";
  } else if (busy) {
    buttonLabel = "Sending…";
  }
  return {
    stage,
    busy,
    buttonLabel,
    buttonDisabled: busy,
    showCode: stage === LOGIN_STAGE.code,
    phoneLocked: stage === LOGIN_STAGE.code,
    showChangeNumber: stage === LOGIN_STAGE.code && !busy,
    status: state?.status ?? "",
    error: state?.error ?? "",
  };
}

export function submitIntent(state) {
  if (state?.busy) return { type: "ignore" };
  if (state?.stage === LOGIN_STAGE.code) return { type: "verify" };
  return { type: "send" };
}

export function reduceLoginForm(state, action) {
  const current = state ?? initialLoginForm();
  switch (action?.type) {
    case "send-start":
      return {
        ...current,
        stage: LOGIN_STAGE.phone,
        busy: true,
        error: "",
        status: "Sending a verification code…",
      };
    case "send-success":
      return {
        ...current,
        stage: LOGIN_STAGE.code,
        busy: false,
        error: "",
        status: "Enter the code sent to your phone.",
      };
    case "send-failure":
      return {
        ...current,
        stage: LOGIN_STAGE.phone,
        busy: false,
        error: action.error ?? "Something went wrong while signing in. Reload the page and try again.",
        status: "",
      };
    case "verify-start":
      return {
        ...current,
        stage: LOGIN_STAGE.code,
        busy: true,
        error: "",
        status: "Verifying…",
      };
    case "verify-failure":
      return {
        ...current,
        stage: LOGIN_STAGE.code,
        busy: false,
        error: action.error ?? "That code was not valid. Try again.",
        status: "",
      };
    case "verify-success":
      return {
        ...current,
        stage: LOGIN_STAGE.code,
        busy: false,
        error: "",
        status: "",
      };
    case "validate":
      return {
        ...current,
        busy: false,
        error: action.error ?? "",
        status: "",
      };
    case "reset":
      return {
        ...initialLoginForm(),
        status: action.status ?? "",
        error: action.error ?? "",
      };
    default:
      return current;
  }
}
