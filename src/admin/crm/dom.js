/** DOM helpers for the CRM admin (store-listing 001 increment 4). Text always goes in via text nodes. */
import { formatApiError } from "../api.js";

/** h("button", { class: "btn", onclick }, "Save") */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = Boolean(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Toasts: a polite live region; errors are role=alert. Each toast auto-hides after `ms`. */
export function createToaster(host, { ms = 5000, setTimer = (fn, t) => setTimeout(fn, t) } = {}) {
  const region = h("div", { class: "toasts", "aria-live": "polite" });
  host.append(region);
  function push(text, kind) {
    const t = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, text);
    const close = h("button", { type: "button", class: "toast-close", "aria-label": "Dismiss" }, "×");
    close.addEventListener("click", () => t.remove());
    t.append(close);
    region.append(t);
    if (ms > 0) setTimer(() => t.remove(), kind === "error" ? ms * 2 : ms);
    return t;
  }
  return {
    node: region,
    ok: (text) => push(text, "ok"),
    error: (err) => push(typeof err === "string" ? err : formatApiError(err), "error"),
    info: (text) => push(text, "info"),
  };
}

/** Disables `btn` while `fn` runs; errors go to `toast.error`. Returns fn's result or undefined. */
export async function busy(btn, toast, fn) {
  const label = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  try {
    return await fn();
  } catch (err) {
    toast?.error(err);
    return undefined;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      if (label !== undefined && btn.textContent === "") btn.textContent = label;
    }
  }
}

/**
 * Minimal modal dialog (no <dialog>, so jsdom tests behave like browsers). `build(close)` returns the body nodes.
 * Escape and the backdrop close it. Returns { node, close }.
 */
export function openModal(host, { title, build }) {
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
  const backdrop = h("div", { class: "modal-backdrop tools" }, box);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
  box.append(h("h2", { class: "modal-title" }, title), ...[build(close)].flat());
  host.append(backdrop);
  box.querySelector("input, select, textarea, button")?.focus();
  return { node: backdrop, close };
}

/** Labelled field wrapper with an inline error slot. */
export function field(label, input, { hint, required } = {}) {
  const id = input.id || `fld-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const err = h("span", { class: "field-error", hidden: true });
  const node = h("div", { class: "field" }, h("label", { for: id }, label + (required ? " *" : "")), input,
    hint ? h("span", { class: "hint" }, hint) : null, err);
  return {
    node, input, err,
    setError(text) { err.textContent = text || ""; err.hidden = !text; input.setAttribute("aria-invalid", text ? "true" : "false"); },
  };
}

export const emptyState = (title, text, action) =>
  h("div", { class: "empty-state" }, h("p", { class: "empty-title" }, title), text ? h("p", { class: "meta" }, text) : null, action ?? null);

export const fmtBytes = (n) => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** Turns a title into a slug (lower-case words joined by -), max 100 chars. */
export function slugify(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}
