/** CRM list views: search, filters, sort, pagination and completeness badges (store-listing 001 increment 4). */
import { h, emptyState, fmtDate } from "./dom.js";
import { rowBadges } from "./completeness.js";

export const PAGE_SIZE = 25;
const TRI = [["", "Any"], ["true", "Yes"], ["false", "No"]];

export const LIST_CONFIG = {
  places: {
    kind: "place", title: "Places", noun: "place", path: "/v1/admin/places", search: "Search name, slug or city",
    filters: ["country_id", "state_id", "published", "has_cover", "has_scripts", "has_audio"],
    sorts: [["-created_at", "Newest"], ["name", "Name A–Z"], ["-name", "Name Z–A"], ["-updated_at", "Recently updated"], ["created_at", "Oldest"]],
    defaultSort: "-created_at",
  },
  spots: {
    kind: "spot", title: "Spots", noun: "spot", path: "/v1/admin/spots", search: "Search title, slug or place",
    filters: ["has_cover", "has_scripts", "has_audio"],
    sorts: [["position", "Place, then walk order"], ["title", "Title A–Z"], ["-title", "Title Z–A"], ["-updated_at", "Recently updated"], ["-created_at", "Newest"]],
    defaultSort: "position",
  },
  collections: {
    kind: "collection", title: "Collections", noun: "collection", path: "/v1/admin/collections", search: "Search name or slug",
    filters: ["state_id", "published", "has_cover"],
    sorts: [["-created_at", "Newest"], ["name", "Name A–Z"], ["-name", "Name Z–A"], ["-updated_at", "Recently updated"]],
    defaultSort: "-created_at",
  },
};

export function initialListState(section) {
  return { q: "", offset: 0, sort: LIST_CONFIG[section].defaultSort, deleted: false, filters: {} };
}

/** Query params for the list request (empty values dropped by the API client). */
export function listQuery(section, st) {
  const cfg = LIST_CONFIG[section];
  const q = { limit: PAGE_SIZE, offset: st.offset, q: st.q || undefined, sort: st.sort !== cfg.defaultSort ? st.sort : undefined,
    include_deleted: st.deleted ? "true" : undefined };
  for (const f of cfg.filters) if (st.filters?.[f]) q[f] = st.filters[f];
  return q;
}

export const coverThumb = (cdn, coverId, size = 150) =>
  (cdn && coverId ? `${String(cdn).replace(/\/+$/, "")}/images/${encodeURIComponent(coverId)}/${size}.webp` : null);

export function badgeRow(badges) {
  return h("span", { class: "badges" }, badges.map((b) =>
    h("span", { class: `badge ${b.ok ? "badge-ok" : b.partial ? "badge-partial" : "badge-missing"}`, title: b.title }, b.label)));
}

/**
 * Renders a list for `section` into a node. `ctx` has api, toast, navigate, state store, loaders, cdn and isCurrent(token).
 */
export function renderList(ctx, section, token) {
  const cfg = LIST_CONFIG[section];
  ctx.listState[section] ??= initialListState(section);
  const st = ctx.listState[section];
  const tbody = h("tbody");
  const pager = h("div", { class: "pager" });
  const count = h("span", { class: "meta list-count" });
  const q = h("input", { type: "search", placeholder: cfg.search, value: st.q, "aria-label": "Search" });
  const sort = h("select", { "aria-label": "Sort" }, cfg.sorts.map(([v, l]) => h("option", { value: v }, l)));
  sort.value = st.sort;
  const deleted = h("input", { type: "checkbox", checked: st.deleted });
  const filterEls = {};
  const triSelect = (name, label) => {
    const s = h("select", { "aria-label": label, "data-filter": name }, TRI.map(([v, l]) => h("option", { value: v }, `${label}: ${l}`)));
    s.value = st.filters[name] ?? "";
    return s;
  };
  for (const f of cfg.filters) {
    if (f === "published") {
      const s = h("select", { "aria-label": "Published", "data-filter": f },
        h("option", { value: "" }, "Any status"), h("option", { value: "true" }, "Published"), h("option", { value: "false" }, "Draft"));
      s.value = st.filters[f] ?? "";
      filterEls[f] = s;
    } else if (f === "country_id") {
      filterEls[f] = h("select", { "aria-label": "Country", "data-filter": f }, h("option", { value: "" }, "All countries"));
    } else if (f === "state_id") {
      filterEls[f] = h("select", { "aria-label": "State", "data-filter": f }, h("option", { value: "" }, "All states"));
    } else {
      filterEls[f] = triSelect(f, { has_cover: "Cover", has_scripts: "Scripts", has_audio: "Audio" }[f]);
    }
  }
  const newBtn = h("button", { type: "button", class: "btn btn-small", onclick: () => ctx.quickCreate(cfg.kind) }, `New ${cfg.noun}`);
  const apply = () => {
    st.q = q.value.trim();
    st.sort = sort.value;
    st.deleted = deleted.checked;
    for (const [k, el] of Object.entries(filterEls)) st.filters[k] = el.value;
    st.offset = 0;
    void load();
  };
  const form = h("form", { class: "toolbar list-toolbar", role: "search", onsubmit: (e) => { e.preventDefault(); apply(); } },
    q, h("button", { type: "submit", class: "btn btn-small btn-secondary" }, "Search"));
  const filters = h("div", { class: "toolbar filters" }, Object.values(filterEls), sort, h("label", { class: "check" }, deleted, " Show deleted"));
  for (const el of [...Object.values(filterEls), sort, deleted]) el.addEventListener("change", apply);
  const head = cfg.kind === "spot"
    ? ["", "Title", "Place", "Completeness", "Updated", ""]
    : cfg.kind === "place" ? ["", "Name", "State", "Status", "Completeness", "Updated", ""] : ["", "Name", "State", "Status", "Completeness", "Updated", ""];
  const node = h("section", { class: "list-view", "aria-labelledby": `h-${section}` },
    h("div", { class: "view-head" }, h("h2", { id: `h-${section}` }, cfg.title), count, newBtn),
    form, filters,
    h("div", { class: "table-wrap" }, h("table", { class: "data crm-table" }, h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))), tbody)),
    pager);

  async function fillPickers() {
    try {
      if (filterEls.country_id) {
        const countries = await ctx.loadCountries();
        filterEls.country_id.append(...countries.map((c) => h("option", { value: c.id }, c.name)));
        filterEls.country_id.value = st.filters.country_id ?? "";
      }
      if (filterEls.state_id) {
        const states = await ctx.loadStates();
        filterEls.state_id.append(...states.map((s) => h("option", { value: s.id }, s.name)));
        filterEls.state_id.value = st.filters.state_id ?? "";
      }
    } catch (err) {
      if (ctx.isCurrent(token)) ctx.toast.error(err);
    }
  }

  async function load() {
    tbody.replaceChildren(h("tr", {}, h("td", { colspan: head.length, class: "meta" }, "Loading…")));
    let res;
    let languages = [];
    try {
      [res, languages] = await Promise.all([
        ctx.api.get("content", cfg.path, listQuery(section, st)),
        cfg.kind === "collection" ? [] : ctx.loadLanguages().catch(() => []),
      ]);
    } catch (err) {
      if (!ctx.isCurrent(token)) return;
      tbody.replaceChildren(h("tr", {}, h("td", { colspan: head.length }, "Could not load.")));
      ctx.toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    const items = res?.items ?? [];
    const total = Number(res?.total ?? items.length);
    count.textContent = `${total} total`;
    tbody.replaceChildren(...items.map((row) => {
      const title = row.name ?? row.title ?? row.slug;
      const thumbUrl = coverThumb(ctx.cdn, row.cover);
      const open = () => ctx.navigate({ section, id: row.id });
      const tr = h("tr", { class: `clickable${row.is_deleted ? " row-deleted" : ""}`, tabindex: "0", "data-id": row.id },
        h("td", { class: "thumb-cell" }, thumbUrl ? h("img", { src: thumbUrl, alt: "", width: 48, height: 36, loading: "lazy" }) : h("span", { class: "thumb-empty", "aria-hidden": "true" })),
        h("td", {}, h("span", { class: "row-title" }, title), h("br"), h("code", {}, row.slug)),
        cfg.kind === "spot" ? h("td", {}, row.place_name ?? "") : h("td", {}, row.state_name ?? ""),
        cfg.kind === "spot" ? null : h("td", {}, h("span", { class: `pill ${row.published ? "pill-ok" : "pill-draft"}` }, row.is_deleted ? "Deleted" : row.published ? "Published" : "Draft")),
        h("td", {}, badgeRow(rowBadges(cfg.kind, row, languages))),
        h("td", { class: "meta" }, fmtDate(row.updated_at)),
        h("td", {}, h("button", { type: "button", class: "btn-text", onclick: (e) => { e.stopPropagation(); open(); } }, "Open")));
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    }));
    if (!items.length) {
      const filtered = st.q || st.deleted || Object.values(st.filters).some(Boolean);
      tbody.replaceChildren(h("tr", {}, h("td", { colspan: head.length },
        filtered
          ? emptyState(`No ${cfg.title.toLowerCase()} match these filters.`, "Clear the search or filters to see everything.")
          : emptyState(`No ${cfg.title.toLowerCase()} yet.`, cfg.kind === "spot" ? "Spots live inside a place. Create one here or from a place." : `Create the first ${cfg.noun}.`,
            h("button", { type: "button", class: "btn btn-small", onclick: () => ctx.quickCreate(cfg.kind) }, `New ${cfg.noun}`)))));
    }
    const from = items.length ? st.offset + 1 : 0;
    const to = st.offset + items.length;
    pager.replaceChildren(
      h("span", {}, `${from}–${to} of ${total}`),
      h("button", { type: "button", class: "btn-text", disabled: st.offset <= 0, onclick: () => { st.offset = Math.max(0, st.offset - PAGE_SIZE); void load(); } }, "Previous"),
      h("button", { type: "button", class: "btn-text", disabled: to >= total, onclick: () => { st.offset += PAGE_SIZE; void load(); } }, "Next"));
  }

  void load();
  void fillPickers();
  return { node, reload: load };
}
