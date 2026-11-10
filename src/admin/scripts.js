/** Narration scripts panel for place/spot admin screens (docs 019 / store-listing 001).
 * Catalogue summary stays on the entity form; this edits skim + detailed via bk-media.
 */

import { formatApiError } from "./api.js";

function h(tag, attrs = {}, ...children) {
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

const FORMATS = ["skim", "detailed"];

/** Builds `{ place_id }` or `{ spot_id }` for list/upsert query and body. */
export function scriptTargetQuery(kind, id) {
  if (kind === "place") return { place_id: id };
  if (kind === "spot") return { spot_id: id };
  throw new Error(`Scripts are only for place or spot, not ${kind}`);
}

/**
 * Loads languages and existing scripts for one target+language.
 * Returns `{ languages, byFormat: { skim?, detailed? } }` where each format value
 * is `{ id, version, content }` or null when no row.
 */
export async function loadScriptEditors(api, { kind, id, language }) {
  const languages = (await api.get("media", "/v1/admin/script-languages", { limit: 100 }))?.items ?? [];
  const live = languages.filter((l) => !l.is_deleted);
  const target = scriptTargetQuery(kind, id);
  const list = language
    ? (await api.get("media", "/v1/admin/scripts", { ...target, language, limit: 10 }))?.items ?? []
    : [];
  const byFormat = { skim: null, detailed: null };
  for (const format of FORMATS) {
    const row = list.find((s) => s.format === format && !s.is_deleted);
    if (!row) continue;
    const full = await api.get("media", `/v1/admin/scripts/${encodeURIComponent(row.id)}`);
    byFormat[format] = { id: full.id, version: full.version, content: full.content ?? "" };
  }
  return { languages: live, byFormat };
}

/** PUT upsert; returns `{ script, changed }`. */
export function saveScript(api, { kind, id, language, format, content }) {
  return api.put("media", "/v1/admin/scripts", {
    ...scriptTargetQuery(kind, id),
    language,
    format,
    content,
  });
}

/**
 * Mounts the narration panel. `api` is createApiClient. Returns `{ node }`.
 * `isCurrent()` gates async paints after navigation.
 */
export function renderScriptsPanel({ api, kind, id, isCurrent = () => true }) {
  const msg = (() => {
    const status = h("p", { class: "status", role: "status", hidden: true });
    const error = h("p", { class: "error", role: "alert", hidden: true });
    const set = (el, text) => { el.hidden = !text; el.textContent = text || ""; };
    return {
      nodes: [status, error],
      ok(text) { set(status, text); set(error, ""); },
      fail(err) { set(error, typeof err === "string" ? err : formatApiError(err)); set(status, ""); },
      clear() { set(status, ""); set(error, ""); },
    };
  })();

  const langSelect = h("select", { "aria-label": "Script language" });
  const editors = h("div", { class: "script-editors" });
  const node = h(
    "section",
    { class: "panel scripts-panel" },
    h("h3", {}, "Narration scripts"),
    h("p", { class: "meta" }, "Skim and detailed narration text. The catalogue summary above is a short blurb, not narration."),
    h("div", { class: "toolbar" }, h("label", { class: "field" }, h("span", {}, "Language"), langSelect)),
    ...msg.nodes,
    editors,
  );

  let languages = [];
  let currentLang = "";

  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      if (isCurrent()) msg.fail(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function paintEditors(byFormat) {
    editors.replaceChildren(...FORMATS.map((format) => {
      const existing = byFormat[format];
      const area = h("textarea", {
        id: `script-${format}`,
        rows: 8,
        "aria-label": `${format} script`,
        value: existing?.content ?? "",
      });
      // value attr is ignored for textarea in createElement path; set property.
      area.value = existing?.content ?? "";
      const version = h("p", { class: "meta script-version" }, existing ? `Version ${existing.version}` : "No script saved yet");
      const save = h("button", { type: "button", class: "btn btn-small" }, `Save ${format}`);
      save.addEventListener("click", () => busy(save, async () => {
        const content = area.value.trim();
        if (!content) { msg.fail("Script content cannot be empty."); return; }
        if (!currentLang) { msg.fail("Pick a language."); return; }
        const res = await saveScript(api, { kind, id, language: currentLang, format, content });
        if (!isCurrent()) return;
        const script = res?.script;
        version.textContent = script ? `Version ${script.version}` : version.textContent;
        msg.ok(res?.changed ? `Saved ${format} (version ${script?.version ?? "?"}).` : `${format} unchanged.`);
      }));
      return h("div", { class: "script-block" }, h("h4", {}, format === "skim" ? "Skim script" : "Detailed script"), version, area, h("div", { class: "actions" }, save));
    }));
  }

  async function loadLanguage(code) {
    currentLang = code;
    msg.clear();
    try {
      const data = await loadScriptEditors(api, { kind, id, language: code });
      if (!isCurrent()) return;
      languages = data.languages;
      paintLangOptions();
      if (code) langSelect.value = code;
      paintEditors(data.byFormat);
    } catch (err) {
      if (isCurrent()) msg.fail(err);
    }
  }

  function paintLangOptions() {
    const prev = langSelect.value || currentLang;
    langSelect.replaceChildren(...languages.map((l) => h("option", { value: l.code }, `${l.name} (${l.code})`)));
    if (!languages.length) {
      langSelect.replaceChildren(h("option", { value: "" }, "No languages"));
      currentLang = "";
      return;
    }
    if (prev && languages.some((l) => l.code === prev)) langSelect.value = prev;
    else langSelect.value = languages[0].code;
    currentLang = langSelect.value;
  }

  langSelect.addEventListener("change", () => { void loadLanguage(langSelect.value); });

  void (async () => {
    try {
      const data = await loadScriptEditors(api, { kind, id, language: "" });
      if (!isCurrent()) return;
      languages = data.languages;
      paintLangOptions();
      if (currentLang) await loadLanguage(currentLang);
      else paintEditors({ skim: null, detailed: null });
    } catch (err) {
      if (isCurrent()) msg.fail(err);
    }
  })();

  return { node };
}
