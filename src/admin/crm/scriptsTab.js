/** Scripts tab (store-listing 001 increment 4; docs 019): language picker, skim + detailed editors, versions. */
import { h, busy, emptyState, fmtDate } from "./dom.js";
import { saveScript, scriptTargetQuery } from "../scripts.js";

const FORMATS = ["skim", "detailed"];
export const WORDS_PER_MINUTE = 140;

/** "123 words · 812 chars · ~1 min" */
export function textStats(text) {
  const t = String(text ?? "").trim();
  const words = t ? t.split(/\s+/).length : 0;
  const mins = words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0;
  return `${words} words · ${t.length} chars${mins ? ` · ~${mins} min` : ""}`;
}

/** ctx: { api, toast, isCurrent, setDirty, loadLanguages, navigate, route, audioPreset }. */
export function renderScripts(ctx, target, token) {
  const { api, toast } = ctx;
  const q = scriptTargetQuery(target.kind, target.id);
  const chips = h("div", { class: "lang-chips", role: "tablist", "aria-label": "Script language" });
  const editors = h("div", { class: "script-editors" });
  const node = h("div", { class: "scripts-tab" },
    h("p", { class: "meta" }, "Narration text per language. Skim is the short tour, detailed the full one. Each save with changed text makes a new version; audio takes remember the version they were made from."),
    chips, editors);
  let languages = [];
  let list = [];
  let current = "";
  const dirty = { skim: false, detailed: false };
  const syncDirty = () => ctx.setDirty("scripts", dirty.skim || dirty.detailed);

  async function loadList() {
    list = (await api.get("media", "/v1/admin/scripts", { ...q, limit: 100 }))?.items ?? [];
  }

  function paintChips() {
    chips.replaceChildren(...languages.map((l) => {
      const have = new Set(list.filter((s) => s.language === l.code && !s.is_deleted).map((s) => s.format));
      const state = have.size === 2 ? "done" : have.size ? "partial" : "none";
      const b = h("button", { type: "button", role: "tab", class: `chip chip-${state}`, "aria-selected": String(l.code === current), title: `skim ${have.has("skim") ? "✓" : "missing"}, detailed ${have.has("detailed") ? "✓" : "missing"}` },
        `${l.name ?? l.code}`, h("span", { class: "chip-mark" }, state === "done" ? " ✓" : state === "partial" ? " ½" : ""));
      b.addEventListener("click", () => {
        if (l.code === current) return;
        if ((dirty.skim || dirty.detailed) && !ctx.confirmFn("You have unsaved script changes. Switch language anyway?")) return;
        void open(l.code);
      });
      return b;
    }));
  }

  async function open(code) {
    current = code;
    dirty.skim = dirty.detailed = false;
    syncDirty();
    paintChips();
    editors.replaceChildren(h("p", { class: "meta" }, "Loading…"));
    const byFormat = {};
    try {
      for (const format of FORMATS) {
        const row = list.find((s) => s.language === code && s.format === format && !s.is_deleted);
        byFormat[format] = row ? await api.get("media", `/v1/admin/scripts/${encodeURIComponent(row.id)}`) : null;
      }
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token) || current !== code) return;
    editors.replaceChildren(...FORMATS.map((format) => editor(format, byFormat[format])));
  }

  function editor(format, row) {
    let saved = row?.content ?? "";
    const area = h("textarea", { rows: format === "skim" ? 8 : 16, "aria-label": `${format} script`, placeholder: `Write the ${format} narration…` });
    area.value = saved;
    const stats = h("span", { class: "meta" }, textStats(saved));
    const version = h("span", { class: "meta script-version" }, row ? `Version ${row.version} · saved ${fmtDate(row.updated_at)}` : "Not written yet");
    const flag = h("span", { class: "dirty-flag", hidden: true }, "Unsaved");
    const err = h("span", { class: "field-error", hidden: true });
    const save = h("button", { type: "button", class: "btn btn-small", disabled: true }, `Save ${format}`);
    const audioBtn = h("button", { type: "button", class: "btn-text", disabled: !row }, "Generate audio →");
    const mark = () => {
      dirty[format] = area.value !== saved;
      flag.hidden = !dirty[format];
      save.disabled = !dirty[format];
      stats.textContent = textStats(area.value);
      syncDirty();
    };
    area.addEventListener("input", () => { err.hidden = true; mark(); });
    const doSave = () => busy(save, toast, async () => {
      const content = area.value.trim();
      if (!content) { err.textContent = "Script text cannot be empty."; err.hidden = false; return; }
      const res = await saveScript(api, { kind: target.kind, id: target.id, language: current, format, content });
      saved = area.value = content;
      mark();
      const s = res?.script;
      if (s) version.textContent = `Version ${s.version} · saved ${fmtDate(s.updated_at)}`;
      audioBtn.disabled = false;
      toast.ok(res?.changed ? `Saved ${format} script (version ${s?.version ?? "?"}).` : `${format} script unchanged.`);
      await loadList();
      if (ctx.isCurrent(token)) paintChips();
    });
    save.addEventListener("click", () => void doSave());
    area.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!save.disabled) void doSave(); }
    });
    audioBtn.addEventListener("click", () => {
      ctx.audioPreset = { language: current, format };
      ctx.navigate({ ...ctx.route, tab: "audio" });
    });
    return h("section", { class: "panel script-block" },
      h("div", { class: "panel-head" }, h("h3", {}, format === "skim" ? "Skim script" : "Detailed script"), flag),
      version, area, err, h("div", { class: "actions" }, save, stats, audioBtn));
  }

  (async () => {
    try {
      [languages] = await Promise.all([ctx.loadLanguages(), loadList()]);
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    if (!languages.length) {
      editors.replaceChildren(emptyState("No script languages.", "Add a language in the backend (script-languages) first."));
      return;
    }
    const first = list.find((s) => !s.is_deleted)?.language ?? languages[0].code;
    await open(languages.some((l) => l.code === first) ? first : languages[0].code);
  })();

  return { node };
}
