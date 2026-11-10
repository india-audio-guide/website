/** CRM admin console (store-listing 001 increment 4): left nav, hash routes, list views and record tabs.
 * Mounted only after the role gate passes (main.js). Text goes in via text nodes only; all data goes
 * through the admin APIs (bk-content, bk-media), never straight to the database.
 */
import { h, createToaster } from "./crm/dom.js";
import { parseHash, formatHash, SECTIONS } from "./crm/route.js";
import { renderList, PAGE_SIZE } from "./crm/lists.js";
import { renderRecord } from "./crm/record.js";
import { renderVoiceList, renderVoiceRecord } from "./crm/voices.js";
import { quickCreate } from "./crm/quickCreate.js";

export { h, PAGE_SIZE };

export const NAV = Object.freeze([
  { section: "places", label: "Places", kind: "place" },
  { section: "spots", label: "Spots", kind: "spot" },
  { section: "collections", label: "Collections", kind: "collection" },
  { section: "voices", label: "Voices", kind: "voice" },
]);
export const UNSAVED_PROMPT = "You have unsaved changes. Leave this page anyway?";

/**
 * Mounts the console into `root`. `api` is createApiClient(...). Returns `{ unmount, navigate }`.
 * `confirmFn`, `fetchImpl`, `putImpl`, `sleep` and `win` (window) are injectable for tests.
 */
export function mountAdminTools(root, { api, fetchImpl, putImpl, confirmFn = (t) => window.confirm(t), sleep, cdn = "", win = window } = {}) {
  let alive = true;
  let viewToken = 0;
  let route = null;
  let currentHash = "";
  const dirty = new Map();
  const cache = {};
  const once = (key, load) => {
    cache[key] ??= load().catch((err) => { delete cache[key]; throw err; });
    return cache[key];
  };

  const navList = h("ul", {}, NAV.map((n) => h("li", {}, h("a", { href: `#/${n.section}`, class: "crm-nav-link", "data-section": n.section }, n.label))));
  const newBtn = h("button", { type: "button", class: "btn btn-small crm-new", "aria-haspopup": "menu", "aria-expanded": "false" }, "+ New");
  const newMenu = h("ul", { class: "crm-new-menu", role: "menu", hidden: true },
    NAV.map((n) => h("li", { role: "none" }, h("button", { type: "button", role: "menuitem", "data-kind": n.kind, onclick: () => { toggleMenu(false); ctx.quickCreate(n.kind); } }, n.label.replace(/s$/, "")))));
  const toggleMenu = (open) => { newMenu.hidden = !open; newBtn.setAttribute("aria-expanded", String(open)); };
  newBtn.addEventListener("click", () => toggleMenu(newMenu.hidden));
  const nav = h("nav", { class: "crm-nav", "aria-label": "Admin sections" }, h("div", { class: "crm-new-wrap" }, newBtn, newMenu), navList);
  const view = h("main", { class: "crm-view", tabindex: "-1" });
  const shell = h("div", { class: "tools crm" }, nav, view);
  root.replaceChildren(shell);
  root.hidden = false;
  const toast = createToaster(root);

  const ctx = {
    api, fetchImpl, putImpl, confirmFn, sleep, cdn, toast,
    modalHost: root,
    listState: {},
    audioPreset: null,
    get route() { return route; },
    isCurrent: (token) => alive && token === viewToken,
    setDirty(key, value) { if (value) dirty.set(key, true); else dirty.delete(key); },
    isDirty: () => dirty.size > 0,
    // The page title belongs to main.js (signed-in chrome); the record name is shown in the view header.
    setTitle() {},
    loadStates: () => once("states", async () => (await api.get("content", "/v1/admin/states", { limit: 200 }))?.items ?? []),
    loadCountries: () => once("countries", async () => (await api.get("content", "/v1/admin/countries", { limit: 200 }))?.items ?? []),
    loadLanguages: () => once("languages", async () => ((await api.get("media", "/v1/admin/script-languages", { limit: 100 }))?.items ?? []).filter((l) => !l.is_deleted)),
    loadTtsOptions: () => once("tts", () => api.get("media", "/v1/admin/tts/options")),
    quickCreate: (kind, preset) => quickCreate(ctx, kind, preset ?? (kind === "spot" && route?.kind === "place" && route.id ? { place_id: route.id } : {})),
    navigate(next, { force = false } = {}) {
      const hash = formatHash(next);
      if (!force && hash !== currentHash && dirty.size && !confirmFn(UNSAVED_PROMPT)) return false;
      dirty.clear();
      if (win.location.hash === hash) render(hash);
      else win.location.hash = hash;
      return true;
    },
  };

  function render(hash) {
    currentHash = hash;
    route = parseHash(hash);
    viewToken += 1;
    const token = viewToken;
    dirty.clear();
    toggleMenu(false);
    for (const a of navList.querySelectorAll("a")) {
      const on = a.dataset.section === route.section;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    let content;
    if (route.section === "voices") content = route.id ? renderVoiceRecord(ctx, route, token) : renderVoiceList(ctx, token);
    else if (route.id && route.id !== "new") content = renderRecord(ctx, route, token);
    else content = renderList(ctx, route.section, token);
    view.replaceChildren(content.node);
  }

  const onHash = () => {
    const next = win.location.hash || "#/places";
    if (next === currentHash) return;
    const same = parseHash(next);
    const prev = route;
    const leavingRecord = !prev || prev.id !== same.id || prev.section !== same.section || prev.tab !== same.tab;
    if (leavingRecord && dirty.size && !confirmFn(UNSAVED_PROMPT)) {
      // Put the old hash back without re-rendering.
      win.history?.replaceState?.(null, "", currentHash);
      if (win.location.hash !== currentHash) { const keep = currentHash; win.location.hash = keep; }
      return;
    }
    render(next);
  };
  const onBeforeUnload = (e) => {
    if (!dirty.size) return undefined;
    e.preventDefault();
    e.returnValue = "";
    return "";
  };
  const onDocClick = (e) => { if (!newMenu.hidden && !nav.querySelector(".crm-new-wrap").contains(e.target)) toggleMenu(false); };
  win.addEventListener("hashchange", onHash);
  win.addEventListener("beforeunload", onBeforeUnload);
  win.document?.addEventListener("click", onDocClick);

  const start = win.location.hash && SECTIONS.includes(parseHash(win.location.hash).section) && win.location.hash.startsWith("#/") ? win.location.hash : "#/places";
  render(start);

  return {
    navigate: ctx.navigate,
    ctx,
    unmount() {
      alive = false;
      viewToken += 1;
      win.removeEventListener("hashchange", onHash);
      win.removeEventListener("beforeunload", onBeforeUnload);
      win.document?.removeEventListener("click", onDocClick);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
