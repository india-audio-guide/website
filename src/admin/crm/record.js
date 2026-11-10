/** Record detail with tabs (store-listing 001 increment 4): Details, Media, Spots, Scripts, Audio, Places. */
import { h, busy, emptyState, field, fmtDate, slugify } from "./dom.js";
import { ENTITIES, nextPosition, parseField, parsePosition, rowToValues, toPatchPayload } from "../forms.js";
import { TABS, SECTION_OF } from "./route.js";
import { renderMedia } from "./media.js";
import { renderScripts } from "./scriptsTab.js";
import { renderAudio } from "./audio.js";
import { badgeRow, coverThumb } from "./lists.js";
import { rowBadges } from "./completeness.js";

export const TAB_LABELS = { details: "Details", media: "Media", spots: "Spots", scripts: "Scripts", audio: "Audio", places: "Places" };

/** Builds the form inputs for an entity. Returns { node, values(), setErrors(errors), inputs }. */
export function entityForm(kind, row, { states = [], onInput = () => {}, mode = "edit" } = {}) {
  const meta = ENTITIES[kind];
  const values = rowToValues(kind, row);
  const fields = {};
  const nodes = [];
  for (const f of meta.fields) {
    if (mode === "edit" && f.createOnly) continue;
    let input;
    if (f.type === "bool") input = h("input", { type: "checkbox", checked: values[f.name] });
    else if (f.type === "textarea") { input = h("textarea", { rows: 4, maxlength: f.max }); input.value = values[f.name]; }
    else if (f.type === "state") {
      input = h("select", {}, h("option", { value: "" }, "Pick a state"), states.map((s) => h("option", { value: s.id }, s.name)));
      input.value = values[f.name];
    } else {
      input = h("input", { type: "text", value: values[f.name], maxlength: f.max, inputmode: ["int", "float"].includes(f.type) ? "decimal" : undefined });
    }
    input.name = f.name;
    const fl = field(f.label, input, { required: f.required && f.type !== "bool", hint: f.patternHint });
    if (f.type === "bool") {
      fl.node.classList.add("field-check");
      fl.node.querySelector("label").prepend(input);
    }
    const validate = () => fl.setError(parseField(f, f.type === "bool" ? input.checked : input.value).error);
    input.addEventListener("blur", validate);
    input.addEventListener("input", () => { if (input.getAttribute("aria-invalid") === "true") validate(); onInput(); });
    input.addEventListener("change", onInput);
    fields[f.name] = fl;
    nodes.push(fl.node);
  }
  const read = () => Object.fromEntries(Object.entries(fields).map(([k, fl]) => [k, fl.input.type === "checkbox" ? fl.input.checked : fl.input.value]));
  return {
    node: h("div", { class: "form-grid" }, nodes),
    inputs: fields,
    values: read,
    setErrors(errors = {}) { for (const [k, fl] of Object.entries(fields)) fl.setError(errors[k]); },
  };
}

/** Renders one record. ctx carries api, toast, navigate, setDirty, loaders, confirmFn and isCurrent. */
export function renderRecord(ctx, route, token) {
  const { api, toast, confirmFn } = ctx;
  const { kind, id } = route;
  const meta = ENTITIES[kind];
  const base = `${meta.path}/${encodeURIComponent(id)}`;
  const node = h("article", { class: "record" }, h("p", { class: "meta" }, "Loading…"));
  let row = null;

  const tabFor = (tab) => {
    switch (tab) {
      case "media": return renderMedia(ctx, { parentType: meta.parentType, parentId: id, cover: row.cover, onCover: (c) => { row = { ...row, cover: c }; paintHeader(); } }, token).node;
      case "scripts": return renderScripts(ctx, { kind, id }, token).node;
      case "audio": return renderAudio(ctx, { kind, id }, token).node;
      case "spots": return renderSpotsTab(ctx, row, token).node;
      case "places": return renderMembersTab(ctx, row, token).node;
      default: return renderDetails();
    }
  };

  const header = h("header", { class: "record-head" });
  function paintHeader() {
    const title = row[meta.titleField] ?? row.slug;
    const thumb = coverThumb(ctx.cdn, row.cover, 320);
    const actions = h("div", { class: "record-actions" });
    const act = (label, fn, cls = "btn btn-small btn-secondary") => {
      const b = h("button", { type: "button", class: cls }, label);
      b.addEventListener("click", () => void busy(b, toast, fn));
      actions.append(b);
    };
    if (meta.publish && !row.is_deleted) {
      if (row.published) act("Unpublish", async () => { row = await api.post("content", `${base}/unpublish`); paintHeader(); toast.ok("Unpublished."); });
      else act("Publish", async () => { row = await api.post("content", `${base}/publish`); paintHeader(); toast.ok("Published."); }, "btn btn-small");
    }
    if (row.is_deleted) act("Restore", async () => { row = await api.post("content", `${base}/restore`); paintHeader(); toast.ok("Restored."); });
    else act("Delete", async () => {
      if (!confirmFn(`Delete this ${meta.label.toLowerCase()}? It is a soft delete and can be restored.`)) return;
      await api.del("content", base);
      row = await api.get("content", base);
      paintHeader();
      toast.ok("Deleted. Restore brings it back.");
    }, "btn btn-small btn-danger");
    const crumbs = [h("a", { href: `#/${SECTION_OF[kind]}` }, meta.plural)];
    if (kind === "spot" && row.place_id) crumbs.push(" / ", h("a", { href: `#/places/${row.place_id}/spots` }, "Place"));
    const status = [
      meta.publish ? h("span", { class: `pill ${row.published ? "pill-ok" : "pill-draft"}` }, row.published ? "Published" : "Draft") : null,
      row.is_deleted ? h("span", { class: "pill pill-failed" }, "Deleted") : null,
      h("span", { class: `pill ${row.cover ? "pill-ok" : "pill-draft"}` }, row.cover ? "Cover set" : "No cover"),
    ];
    header.replaceChildren(
      h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, crumbs),
      h("div", { class: "record-title" },
        thumb ? h("img", { class: "record-cover", src: thumb, alt: "", width: 96, height: 72 }) : h("span", { class: "record-cover thumb-empty", "aria-hidden": "true" }),
        h("div", {}, h("h2", {}, title), h("p", { class: "meta" }, h("code", {}, row.id), ` · ${row.slug} · updated ${fmtDate(row.updated_at)}`), h("div", { class: "status-row" }, status)),
        actions));
    void loadBadges();
  }
  const badgeHost = h("div", { class: "record-badges" });
  async function loadBadges() {
    if (kind === "collection" && !row) return;
    try {
      const listPath = kind === "spot" ? "/v1/admin/spots" : meta.path;
      const q = { q: row.slug, limit: 5, include_deleted: "true" };
      if (kind === "spot") q.place_id = row.place_id;
      const [res, langs] = await Promise.all([api.get("content", listPath, q), kind === "collection" ? [] : ctx.loadLanguages().catch(() => [])]);
      const hit = (res?.items ?? []).find((r) => r.id === row.id);
      if (!ctx.isCurrent(token) || !hit) return;
      badgeHost.replaceChildren(badgeRow(rowBadges(kind, { ...hit, cover: row.cover }, langs)));
    } catch {
      /* badges are a nicety */
    }
  }

  const tabsNav = h("nav", { class: "tabs", role: "tablist", "aria-label": `${meta.label} sections` });
  const panel = h("div", { class: "tab-panel", role: "tabpanel" });
  function paintTabs() {
    tabsNav.replaceChildren(...TABS[kind].map((t) => h("a", {
      href: `#/${SECTION_OF[kind]}/${id}${t === "details" ? "" : `/${t}`}`, role: "tab", class: "tab", "aria-selected": String(t === route.tab),
      "aria-current": t === route.tab ? "page" : undefined,
    }, TAB_LABELS[t])));
  }

  function renderDetails() {
    const save = h("button", { type: "submit", class: "btn", disabled: true }, "Save changes");
    const discard = h("button", { type: "button", class: "btn-text", disabled: true }, "Discard");
    const host = h("div");
    let form;
    const check = () => {
      const res = toPatchPayload(kind, form.values(), row);
      const dirty = !(res.ok && res.empty);
      save.disabled = !dirty;
      discard.disabled = !dirty;
      ctx.setDirty("details", dirty);
    };
    const build = async () => {
      const states = meta.fields.some((f) => f.type === "state") ? await ctx.loadStates().catch(() => []) : [];
      if (!ctx.isCurrent(token)) return;
      form = entityForm(kind, row, { states, onInput: check });
      host.replaceChildren(form.node);
    };
    discard.addEventListener("click", () => { ctx.setDirty("details", false); void build().then(check); });
    const formNode = h("form", { class: "panel details-form", novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const res = toPatchPayload(kind, form.values(), row);
      form.setErrors(res.errors);
      if (!res.ok) { toast.error("Fix the highlighted fields."); return; }
      if (res.empty) return;
      void busy(save, toast, async () => {
        row = await api.patch("content", base, res.payload);
        ctx.setDirty("details", false);
        paintHeader();
        await build();
        check();
        toast.ok("Saved.");
      });
    } }, host, h("div", { class: "actions sticky-actions" }, save, discard));
    void build();
    return formNode;
  }

  (async () => {
    try {
      row = await api.get("content", base);
    } catch (err) {
      if (!ctx.isCurrent(token)) return;
      node.replaceChildren(emptyState(err?.status === 404 ? `${meta.label} not found.` : `Could not load this ${meta.label.toLowerCase()}.`, null,
        h("a", { href: `#/${SECTION_OF[kind]}`, class: "btn btn-small btn-secondary" }, `Back to ${meta.plural.toLowerCase()}`)));
      if (err?.status !== 404) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    ctx.setTitle?.(row[meta.titleField] ?? row.slug);
    paintHeader();
    paintTabs();
    panel.replaceChildren(tabFor(route.tab));
    node.replaceChildren(header, badgeHost, tabsNav, panel);
  })();
  return { node };
}

/** Spots of a place: list (with completeness) and an inline add row. */
export function renderSpotsTab(ctx, place, token) {
  const { api, toast } = ctx;
  const tbody = h("tbody");
  const deleted = h("input", { type: "checkbox" });
  let items = [];
  let languages = [];
  const title = h("input", { type: "text", placeholder: "New spot title", maxlength: "200", "aria-label": "New spot title" });
  const slug = h("input", { type: "text", placeholder: "slug", maxlength: "100", "aria-label": "New spot slug" });
  let slugTouched = false;
  title.addEventListener("input", () => { if (!slugTouched) slug.value = slugify(title.value); });
  slug.addEventListener("input", () => { slugTouched = slug.value !== ""; });
  const addErr = h("span", { class: "field-error", hidden: true });
  const addBtn = h("button", { type: "submit", class: "btn btn-small" }, "Add spot");
  const node = h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h3", {}, "Spots"), h("label", { class: "check" }, deleted, " Show deleted")),
    h("p", { class: "meta" }, "Walk order follows Position. Open a spot to add its images, scripts and audio."),
    h("div", { class: "table-wrap" }, h("table", { class: "data crm-table" },
      h("thead", {}, h("tr", {}, ["#", "Title", "Tours", "Completeness", ""].map((c) => h("th", {}, c)))), tbody)),
    h("form", { class: "inline-add", novalidate: true, onsubmit: (e) => { e.preventDefault(); void add(); } }, title, slug, addBtn, addErr));

  async function add() {
    const t = parseField(ENTITIES.spot.fields.find((f) => f.name === "title"), title.value);
    const s = parseField(ENTITIES.spot.fields.find((f) => f.name === "slug"), slug.value);
    const problem = t.error ? `Title: ${t.error}` : s.error ? `Slug: ${s.error}` : "";
    addErr.textContent = problem;
    addErr.hidden = !problem;
    if (problem) return;
    await busy(addBtn, toast, async () => {
      const created = await api.post("content", `/v1/admin/places/${encodeURIComponent(place.id)}/spots`,
        { slug: s.value, title: t.value, position: nextPosition(items), in_skim: true, in_detailed: true });
      title.value = slug.value = "";
      slugTouched = false;
      toast.ok(`Added ${created?.title ?? "spot"}.`);
      await load();
    });
  }

  async function load() {
    try {
      const [res, langs] = await Promise.all([
        api.get("content", "/v1/admin/spots", { place_id: place.id, limit: 200, include_deleted: deleted.checked ? "true" : undefined }),
        ctx.loadLanguages().catch(() => []),
      ]);
      items = res?.items ?? [];
      languages = langs;
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    tbody.replaceChildren(...items.map((s) => {
      const open = () => ctx.navigate({ section: "spots", id: s.id });
      const tr = h("tr", { class: `clickable${s.is_deleted ? " row-deleted" : ""}`, tabindex: "0" },
        h("td", {}, s.position), h("td", {}, h("span", { class: "row-title" }, s.title), h("br"), h("code", {}, s.slug)),
        h("td", {}, [s.in_skim ? "skim" : null, s.in_detailed ? "detailed" : null].filter(Boolean).join(", ") || "none"),
        h("td", {}, badgeRow(rowBadges("spot", s, languages))),
        h("td", {}, h("button", { type: "button", class: "btn-text", onclick: (e) => { e.stopPropagation(); open(); } }, "Open")));
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    }));
    if (!items.length) tbody.append(h("tr", {}, h("td", { colspan: 5 }, emptyState("No spots yet.", "Add the first stop of the walk below."))));
  }
  deleted.addEventListener("change", () => void load());
  void load();
  return { node };
}

/** Places in a collection: positions, remove, and a search picker to add. */
export function renderMembersTab(ctx, collection, token) {
  const { api, toast, confirmFn } = ctx;
  const base = `/v1/admin/collections/${encodeURIComponent(collection.id)}/places`;
  const tbody = h("tbody");
  const results = h("ul", { class: "picker-results", role: "listbox", "aria-label": "Matching places" });
  const search = h("input", { type: "search", placeholder: "Search places to add…", "aria-label": "Search places to add", autocomplete: "off" });
  let members = [];
  let timer = null;
  const node = h("section", { class: "panel" },
    h("h3", {}, "Places in this collection"),
    h("div", { class: "picker" }, search, results),
    h("div", { class: "table-wrap" }, h("table", { class: "data crm-table" },
      h("thead", {}, h("tr", {}, ["Position", "Place", "Status", ""].map((c) => h("th", {}, c)))), tbody)));

  async function load() {
    try {
      members = (await api.get("content", base))?.items ?? [];
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    tbody.replaceChildren(...members.map((m) => {
      const pos = h("input", { type: "text", inputmode: "numeric", class: "pos", value: String(m.position), "aria-label": `Position of ${m.name}` });
      pos.addEventListener("change", () => {
        const p = parsePosition(pos.value);
        if (p.error) { toast.error(`Position: ${p.error}`); return; }
        void busy(null, toast, async () => { await api.put("content", `${base}/${encodeURIComponent(m.place_id)}`, { position: p.value }); await load(); toast.ok("Position saved."); });
      });
      const rm = h("button", { type: "button", class: "btn-text danger" }, "Remove");
      rm.addEventListener("click", () => {
        if (!confirmFn(`Remove ${m.name} from this collection?`)) return;
        void busy(rm, toast, async () => { await api.del("content", `${base}/${encodeURIComponent(m.place_id)}`); await load(); toast.ok(`Removed ${m.name}.`); });
      });
      return h("tr", { class: m.is_deleted ? "row-deleted" : undefined }, h("td", {}, pos),
        h("td", {}, h("a", { href: `#/places/${m.place_id}` }, m.name), h("br"), h("code", {}, m.slug)),
        h("td", {}, h("span", { class: `pill ${m.published ? "pill-ok" : "pill-draft"}` }, m.published ? "Published" : "Draft")), h("td", {}, rm));
    }));
    if (!members.length) tbody.append(h("tr", {}, h("td", { colspan: 4 }, emptyState("No places yet.", "Search above to add places."))));
  }

  async function find() {
    const q = search.value.trim();
    if (!q) { results.replaceChildren(); return; }
    let res;
    try {
      res = await api.get("content", "/v1/admin/places", { q, limit: 10 });
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token) || search.value.trim() !== q) return;
    const inSet = new Set(members.map((m) => m.place_id));
    results.replaceChildren(...(res?.items ?? []).map((p) => {
      const add = h("button", { type: "button", class: "btn-text", disabled: inSet.has(p.id) }, inSet.has(p.id) ? "Added" : "Add");
      add.addEventListener("click", () => void busy(add, toast, async () => {
        await api.put("content", `${base}/${encodeURIComponent(p.id)}`, { position: nextPosition(members) });
        await load();
        search.value = "";
        results.replaceChildren();
        toast.ok(`Added ${p.name}.`);
      }));
      return h("li", { role: "option" }, h("span", {}, p.name, " ", h("span", { class: "meta" }, p.state_name ?? p.slug)), add);
    }));
    if (!results.children.length) results.append(h("li", { class: "meta" }, "No matching places."));
  }
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => void find(), 250); });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); void find(); } });
  void load();
  return { node, find, load };
}
