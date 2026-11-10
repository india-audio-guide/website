/** Voices section (store-listing 001 increment 4; docs 010): voice list, details and language mappings. */
import { h, busy, emptyState, field, fmtDate } from "./dom.js";

const GENDERS = ["female", "male"];

/** PATCH body for a voice from form values vs the row. Returns { ok, payload, errors, empty }. */
export function voicePatch(values, row) {
  const errors = {};
  const payload = {};
  const name = String(values.display_name ?? "").trim();
  if (!name) errors.display_name = "Required";
  else if (name.length > 100) errors.display_name = "At most 100 characters";
  else if (name !== row.display_name) payload.display_name = name;
  if (!GENDERS.includes(values.gender)) errors.gender = "Pick one";
  else if (values.gender !== row.gender) payload.gender = values.gender;
  const desc = String(values.description ?? "").trim();
  if (desc.length > 500) errors.description = "At most 500 characters";
  else if ((desc || null) !== (row.description ?? null)) payload.description = desc || null;
  const so = String(values.sort_order ?? "").trim();
  if (!/^-?\d+$/.test(so) || Math.abs(Number(so)) > 10000) errors.sort_order = "Whole number between -10000 and 10000";
  else if (Number(so) !== row.sort_order) payload.sort_order = Number(so);
  if (Boolean(values.is_active) !== Boolean(row.is_active)) payload.is_active = Boolean(values.is_active);
  const ok = !Object.keys(errors).length;
  return { ok, errors, payload: ok ? payload : null, empty: ok && !Object.keys(payload).length };
}

export function renderVoiceList(ctx, token) {
  const { api, toast } = ctx;
  const st = (ctx.listState.voices ??= { q: "", language: "", active: "", deleted: false });
  const tbody = h("tbody");
  const q = h("input", { type: "search", placeholder: "Search name or slug", value: st.q, "aria-label": "Search voices" });
  const lang = h("select", { "aria-label": "Language" }, h("option", { value: "" }, "All languages"));
  const active = h("select", { "aria-label": "Active" }, h("option", { value: "" }, "Active: Any"), h("option", { value: "true" }, "Active"), h("option", { value: "false" }, "Inactive"));
  active.value = st.active;
  const deleted = h("input", { type: "checkbox", checked: st.deleted });
  const apply = () => { st.q = q.value.trim(); st.language = lang.value; st.active = active.value; st.deleted = deleted.checked; void load(); };
  for (const el of [lang, active, deleted]) el.addEventListener("change", apply);
  const node = h("section", { class: "list-view" },
    h("div", { class: "view-head" }, h("h2", {}, "Voices"),
      h("button", { type: "button", class: "btn btn-small", onclick: () => ctx.quickCreate("voice") }, "New voice")),
    h("form", { class: "toolbar", role: "search", onsubmit: (e) => { e.preventDefault(); apply(); } }, q, lang, active,
      h("label", { class: "check" }, deleted, " Show deleted"), h("button", { type: "submit", class: "btn btn-small btn-secondary" }, "Search")),
    h("div", { class: "table-wrap" }, h("table", { class: "data crm-table" },
      h("thead", {}, h("tr", {}, ["Voice", "Gender", "Languages", "Status", ""].map((c) => h("th", {}, c)))), tbody)));

  async function load() {
    let items;
    try {
      items = (await api.get("media", "/v1/admin/voices", { limit: 200, q: st.q || undefined, language: st.language || undefined, is_active: st.active || undefined, include_deleted: st.deleted ? "true" : undefined }))?.items ?? [];
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    tbody.replaceChildren(...items.map((v) => {
      const open = () => ctx.navigate({ section: "voices", id: v.id });
      const tr = h("tr", { class: `clickable${v.is_deleted ? " row-deleted" : ""}`, tabindex: "0" },
        h("td", {}, h("span", { class: "row-title" }, v.display_name), h("br"), h("code", {}, v.slug)),
        h("td", {}, v.gender),
        h("td", {}, h("span", { class: "badges" }, (v.languages ?? []).filter((l) => !l.is_deleted).map((l) =>
          h("span", { class: `badge ${l.is_default ? "badge-ok" : "badge-partial"}`, title: l.is_default ? "Default for this language" : "Mapped" }, `${l.language}${l.is_default ? " ★" : ""}`)))),
        h("td", {}, h("span", { class: `pill ${v.is_active ? "pill-ok" : "pill-draft"}` }, v.is_deleted ? "Deleted" : v.is_active ? "Active" : "Inactive")),
        h("td", {}, h("button", { type: "button", class: "btn-text", onclick: (e) => { e.stopPropagation(); open(); } }, "Open")));
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    }));
    if (!items.length) tbody.append(h("tr", {}, h("td", { colspan: 5 }, emptyState("No voices match.", "Create a voice, then map it to ElevenLabs voices per language."))));
  }
  void ctx.loadLanguages().then((ls) => { lang.append(...ls.map((l) => h("option", { value: l.code }, l.name ?? l.code))); lang.value = st.language; }).catch(() => {});
  void load();
  return { node };
}

export function renderVoiceRecord(ctx, route, token) {
  const { api, toast, confirmFn } = ctx;
  const base = `/v1/admin/voices/${encodeURIComponent(route.id)}`;
  const node = h("article", { class: "record" }, h("p", { class: "meta" }, "Loading…"));
  let row = null;
  let languages = [];
  let providerVoices = null;

  async function reload() {
    row = await api.get("media", base);
    if (ctx.isCurrent(token)) paint();
  }

  function detailsForm() {
    const name = h("input", { type: "text", maxlength: "100", value: row.display_name });
    const gender = h("select", {}, GENDERS.map((g) => h("option", { value: g }, g)));
    gender.value = row.gender;
    const desc = h("textarea", { rows: 3, maxlength: "500" });
    desc.value = row.description ?? "";
    const sort = h("input", { type: "text", inputmode: "numeric", value: String(row.sort_order ?? 0) });
    const active = h("input", { type: "checkbox", checked: row.is_active });
    const f = { display_name: field("Display name", name, { required: true }), gender: field("Gender", gender, { required: true }), description: field("Description", desc), sort_order: field("Sort order", sort) };
    const save = h("button", { type: "submit", class: "btn", disabled: true }, "Save changes");
    const values = () => ({ display_name: name.value, gender: gender.value, description: desc.value, sort_order: sort.value, is_active: active.checked });
    const check = () => { const r = voicePatch(values(), row); save.disabled = r.ok && r.empty; ctx.setDirty("details", !(r.ok && r.empty)); };
    for (const el of [name, gender, desc, sort, active]) { el.addEventListener("input", check); el.addEventListener("change", check); }
    return h("form", { class: "panel details-form", novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const r = voicePatch(values(), row);
      for (const [k, fl] of Object.entries(f)) fl.setError(r.errors[k]);
      if (!r.ok || r.empty) return;
      void busy(save, toast, async () => { await api.patch("media", base, r.payload); ctx.setDirty("details", false); await reload(); toast.ok("Voice saved."); });
    } }, h("h3", {}, "Details"), h("div", { class: "form-grid" }, Object.values(f).map((x) => x.node), h("label", { class: "check" }, active, " Active")),
    h("div", { class: "actions" }, save));
  }

  function providerInput(value = "") {
    if (providerVoices?.length) {
      const sel = h("select", { "aria-label": "ElevenLabs voice" }, h("option", { value: "" }, "Pick an ElevenLabs voice"),
        providerVoices.map((p) => h("option", { value: p.provider_voice_id }, `${p.name}${p.category ? ` (${p.category})` : ""}`)));
      if (value && !providerVoices.some((p) => p.provider_voice_id === value)) sel.append(h("option", { value }, value));
      sel.value = value;
      return sel;
    }
    return h("input", { type: "text", maxlength: "200", value, placeholder: "ElevenLabs voice id", "aria-label": "ElevenLabs voice id" });
  }

  function mappings() {
    const tbody = h("tbody");
    const live = (row.languages ?? []).filter((l) => !l.is_deleted);
    tbody.replaceChildren(...live.map((l) => {
      const pid = providerInput(l.provider_voice_id);
      const def = h("input", { type: "checkbox", checked: l.is_default, "aria-label": `Default for ${l.language}` });
      const btn = (label, fn, cls = "btn-text") => { const b = h("button", { type: "button", class: cls }, label); b.addEventListener("click", () => void busy(b, toast, fn)); return b; };
      const lp = `${base}/languages/${encodeURIComponent(l.language)}`;
      return h("tr", {}, h("td", {}, l.language), h("td", {}, pid), h("td", {}, def),
        h("td", {}, l.preview_url ? h("audio", { controls: true, preload: "none", src: l.preview_url }) : h("span", { class: "meta" }, "No preview")),
        h("td", {},
          btn("Save", async () => { if (!pid.value.trim()) throw new Error("Pick an ElevenLabs voice"); await api.put("media", lp, { provider_voice_id: pid.value.trim(), is_default: def.checked }); await reload(); toast.ok(`Saved ${l.language} mapping.`); }),
          btn("Preview", async () => { await api.post("media", `${lp}/preview`, {}); toast.ok("Preview queued. Reload in a minute to hear it."); }),
          btn("Remove", async () => { if (!confirmFn(`Remove the ${l.language} mapping?`)) return; await api.del("media", lp); await reload(); toast.ok("Mapping removed."); }, "btn-text danger")));
    }));
    if (!live.length) tbody.append(h("tr", {}, h("td", { colspan: 5 }, emptyState("Not mapped to any language yet.", "Add a language below to use this voice."))));
    const mapped = new Set(live.map((l) => l.language));
    const langSel = h("select", { "aria-label": "Language" }, h("option", { value: "" }, "Language"), languages.filter((l) => !mapped.has(l.code)).map((l) => h("option", { value: l.code }, `${l.name ?? l.code} (${l.code})`)));
    const pid = providerInput();
    const def = h("input", { type: "checkbox" });
    const add = h("button", { type: "submit", class: "btn btn-small" }, "Add mapping");
    const addForm = h("form", { class: "inline-add", onsubmit: (e) => {
      e.preventDefault();
      if (!langSel.value || !pid.value.trim()) { toast.error("Pick a language and an ElevenLabs voice."); return; }
      void busy(add, toast, async () => {
        await api.put("media", `${base}/languages/${encodeURIComponent(langSel.value)}`, { provider_voice_id: pid.value.trim(), is_default: def.checked });
        await reload();
        toast.ok("Mapping added.");
      });
    } }, langSel, pid, h("label", { class: "check" }, def, " Default"), add);
    return h("section", { class: "panel" }, h("h3", {}, "Languages"),
      h("p", { class: "meta" }, providerVoices ? "ElevenLabs voices from your account." : "Paste the ElevenLabs voice id (the voice list needs the API key)."),
      h("div", { class: "table-wrap" }, h("table", { class: "data crm-table" }, h("thead", {}, h("tr", {}, ["Language", "ElevenLabs voice", "Default", "Preview", ""].map((c) => h("th", {}, c)))), tbody)),
      addForm);
  }

  function paint() {
    const actions = h("div", { class: "record-actions" });
    const act = (label, fn, cls) => { const b = h("button", { type: "button", class: cls }, label); b.addEventListener("click", () => void busy(b, toast, fn)); actions.append(b); };
    if (row.is_deleted) act("Restore", async () => { await api.post("media", `${base}/restore`); await reload(); toast.ok("Voice restored."); }, "btn btn-small btn-secondary");
    else act("Delete", async () => { if (!confirmFn("Delete this voice? It can be restored.")) return; await api.del("media", base); await reload(); toast.ok("Voice deleted."); }, "btn btn-small btn-danger");
    node.replaceChildren(
      h("header", { class: "record-head" }, h("nav", { class: "crumbs" }, h("a", { href: "#/voices" }, "Voices")),
        h("div", { class: "record-title" }, h("div", {}, h("h2", {}, row.display_name),
          h("p", { class: "meta" }, h("code", {}, row.id), ` · ${row.slug} · updated ${fmtDate(row.updated_at)}`),
          h("div", { class: "status-row" }, h("span", { class: `pill ${row.is_active ? "pill-ok" : "pill-draft"}` }, row.is_active ? "Active" : "Inactive"),
            row.is_deleted ? h("span", { class: "pill pill-failed" }, "Deleted") : null)), actions)),
      detailsForm(), mappings());
  }

  (async () => {
    try {
      [row, languages] = await Promise.all([api.get("media", base), ctx.loadLanguages()]);
      const opts = await ctx.loadTtsOptions().catch(() => null);
      if (opts?.key_configured) providerVoices = (await api.get("media", "/v1/admin/tts/provider-voices").catch(() => null))?.items ?? null;
    } catch (err) {
      if (!ctx.isCurrent(token)) return;
      node.replaceChildren(emptyState(err?.status === 404 ? "Voice not found." : "Could not load this voice.", null, h("a", { href: "#/voices", class: "btn btn-small btn-secondary" }, "Back to voices")));
      if (err?.status !== 404) toast.error(err);
      return;
    }
    if (ctx.isCurrent(token)) { ctx.setTitle?.(row.display_name); paint(); }
  })();
  return { node };
}
