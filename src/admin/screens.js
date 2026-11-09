/** Catalogue admin screens: places, spots, collections and their image galleries.
 * Mounted only after the role gate passes (main.js). Text goes in via textContent only.
 */
import { formatApiError } from "./api.js";
import { ENTITIES, nextPosition, parsePosition, rowToValues, toCreatePayload, toPatchPayload } from "./forms.js";
import { UploadError, hasPending, moveImage, pollImages, uploadImage, validateImageFile, IMAGE_TYPES } from "./upload.js";

export const PAGE_SIZE = 25;

/** Small DOM builder: h("button", { class: "btn", onclick }, "Save"). */
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

function messageBox() {
  const status = h("p", { class: "status", role: "status", hidden: true });
  const error = h("p", { class: "error", role: "alert", hidden: true });
  const set = (el, text) => {
    el.hidden = !text;
    el.textContent = text || "";
  };
  return {
    nodes: [status, error],
    ok(text) { set(status, text); set(error, ""); },
    fail(err) { set(error, typeof err === "string" ? err : formatApiError(err)); set(status, ""); },
    clear() { set(status, ""); set(error, ""); },
  };
}

/** Disables `btn` while `fn` runs; reports errors to `msg`. */
async function busy(btn, msg, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    msg.fail(err);
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

const yesNo = (v) => (v ? "yes" : "no");

/**
 * Mounts the tools into `root`. `api` is createApiClient(...). Returns `{ unmount }`.
 * `confirmFn`, `fetchImpl` and `sleep` are injectable for tests.
 */
export function mountAdminTools(root, { api, fetchImpl, confirmFn = (t) => window.confirm(t), sleep } = {}) {
  let alive = true;
  let viewToken = 0;
  let statesPromise = null;
  const container = h("div", { class: "tools" });
  const nav = h("nav", { class: "tools-nav", "aria-label": "Admin sections" });
  const view = h("div", { class: "tools-view" });
  container.append(nav, view);
  root.replaceChildren(container);
  root.hidden = false;

  const tabs = {};
  for (const kind of ["place", "collection"]) {
    tabs[kind] = h("button", { type: "button", class: "tab", onclick: () => showList(kind) }, ENTITIES[kind].plural);
    nav.append(tabs[kind]);
  }

  const isCurrent = (token) => alive && token === viewToken;
  function startView(kind) {
    viewToken += 1;
    for (const [k, t] of Object.entries(tabs)) t.setAttribute("aria-current", k === kind ? "page" : "false");
    view.replaceChildren();
    return viewToken;
  }

  function loadStates() {
    statesPromise ??= api.get("content", "/v1/admin/states", { limit: 200 }).then((r) => r?.items ?? []).catch((err) => {
      statesPromise = null;
      throw err;
    });
    return statesPromise;
  }

  // ---------- list view (places, collections) ----------
  const listState = { place: { offset: 0, q: "", deleted: false, published: "" }, collection: { offset: 0, q: "", deleted: false, published: "" } };

  async function showList(kind) {
    const token = startView(kind);
    const meta = ENTITIES[kind];
    const st = listState[kind];
    const msg = messageBox();
    const q = h("input", { type: "search", placeholder: "Search name or slug", value: st.q, "aria-label": "Search" });
    const deleted = h("input", { type: "checkbox", checked: st.deleted });
    const pub = h("select", { "aria-label": "Published filter" },
      h("option", { value: "" }, "All"), h("option", { value: "true" }, "Published"), h("option", { value: "false" }, "Drafts"));
    pub.value = st.published;
    const tbody = h("tbody");
    const pager = h("div", { class: "pager" });
    const form = h("form", { class: "toolbar", onsubmit: (e) => { e.preventDefault(); st.q = q.value.trim(); st.deleted = deleted.checked; st.published = pub.value; st.offset = 0; load(); } },
      q, pub, h("label", { class: "check" }, deleted, " Show deleted"), h("button", { type: "submit", class: "btn btn-small" }, "Search"),
      h("button", { type: "button", class: "btn btn-small btn-secondary", onclick: () => showEntity(kind, null) }, `New ${meta.label.toLowerCase()}`));
    const cols = kind === "place" ? ["Name", "Slug", "City", "Published", "Deleted", ""] : ["Name", "Slug", "Published", "Deleted", ""];
    view.append(h("h2", {}, meta.plural), form, ...msg.nodes,
      h("div", { class: "table-wrap" }, h("table", { class: "data" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))), tbody)), pager);

    async function load() {
      msg.ok("Loading…");
      let res;
      try {
        res = await api.get("content", meta.path, { limit: PAGE_SIZE, offset: st.offset, q: st.q, include_deleted: st.deleted ? "true" : undefined, published: st.published });
      } catch (err) {
        if (isCurrent(token)) msg.fail(err);
        return;
      }
      if (!isCurrent(token)) return;
      const items = res?.items ?? [];
      tbody.replaceChildren(...items.map((row) => h("tr", { class: row.is_deleted ? "row-deleted" : undefined },
        h("td", {}, row.name), h("td", {}, h("code", {}, row.slug)), kind === "place" ? h("td", {}, row.city ?? "") : null,
        h("td", {}, yesNo(row.published)), h("td", {}, yesNo(row.is_deleted)),
        h("td", {}, h("button", { type: "button", class: "btn-text", onclick: () => showEntity(kind, row.id) }, "Open")))));
      if (!items.length) tbody.append(h("tr", {}, h("td", { colspan: cols.length }, "Nothing found.")));
      const total = Number(res?.total ?? items.length);
      const from = items.length ? st.offset + 1 : 0;
      const to = st.offset + items.length;
      pager.replaceChildren(
        h("span", {}, `${from}–${to} of ${total}`),
        h("button", { type: "button", class: "btn-text", disabled: st.offset <= 0, onclick: () => { st.offset = Math.max(0, st.offset - PAGE_SIZE); load(); } }, "Previous"),
        h("button", { type: "button", class: "btn-text", disabled: to >= total, onclick: () => { st.offset += PAGE_SIZE; load(); } }, "Next"));
      msg.clear();
    }
    await load();
  }

  // ---------- entity form (place, spot, collection) ----------
  function fieldInput(field, value, states) {
    const id = `f-${field.name}`;
    let input;
    if (field.type === "bool") {
      input = h("input", { id, type: "checkbox", checked: value });
      return { input, node: h("label", { class: "check" }, input, ` ${field.label}`), read: () => input.checked };
    }
    if (field.type === "state") {
      input = h("select", { id, required: true }, h("option", { value: "" }, "Pick a state"),
        (states ?? []).map((s) => h("option", { value: s.id }, `${s.name}${s.code ? ` (${s.code})` : ""}${s.is_deleted ? " [deleted]" : ""}`)));
      if (value && !(states ?? []).some((s) => s.id === value)) input.append(h("option", { value }, value));
      input.value = value ?? "";
    } else if (field.type === "textarea") {
      input = h("textarea", { id, rows: 4, maxlength: field.max });
      input.value = value ?? "";
    } else {
      const numeric = field.type === "int" || field.type === "float";
      input = h("input", { id, type: "text", inputmode: numeric ? (field.type === "int" ? "numeric" : "decimal") : undefined, maxlength: field.max, value: value ?? "" });
    }
    const err = h("span", { class: "field-error", hidden: true });
    return {
      input, err,
      node: h("div", { class: "field" }, h("label", { for: id }, field.label + (field.required ? " *" : "")), input, err),
      read: () => input.value,
    };
  }

  async function showEntity(kind, id, ctx = {}) {
    const token = startView(kind === "spot" ? "place" : kind);
    const meta = ENTITIES[kind];
    const msg = messageBox();
    const back = h("button", { type: "button", class: "btn-text", onclick: () => (kind === "spot" ? showEntity("place", ctx.placeId) : showList(kind)) },
      kind === "spot" ? "← Back to place" : `← All ${meta.plural.toLowerCase()}`);
    view.append(back, ...msg.nodes);
    msg.ok("Loading…");

    let row = null;
    let states = [];
    try {
      const needsStates = meta.fields.some((f) => f.type === "state");
      [row, states] = await Promise.all([
        id ? api.get("content", `${meta.path}/${encodeURIComponent(id)}`) : null,
        needsStates ? loadStates() : [],
      ]);
    } catch (err) {
      if (isCurrent(token)) msg.fail(err);
      return;
    }
    if (!isCurrent(token)) return;
    msg.clear();
    if (kind === "spot" && row?.place_id) ctx = { ...ctx, placeId: row.place_id };

    const heading = h("h2", {});
    const sub = h("p", { class: "meta" });
    const values = id ? rowToValues(kind, row) : { ...rowToValues(kind, {}), ...(ctx.defaults ?? {}) };
    const inputs = {};
    const formFields = meta.fields.filter((f) => !(id && f.createOnly));
    const save = h("button", { type: "submit", class: "btn" }, id ? "Save changes" : `Create ${meta.label.toLowerCase()}`);
    const form = h("form", { class: "entity-form", novalidate: true }, formFields.map((f) => {
      const fi = fieldInput(f, values[f.name], states);
      inputs[f.name] = fi;
      return fi.node;
    }), h("div", { class: "actions" }, save));
    const actions = h("div", { class: "actions" });
    view.append(heading, sub, actions, form);

    function paintHeader() {
      heading.textContent = id ? `${meta.label}: ${row[meta.titleField] ?? row.slug}` : `New ${meta.label.toLowerCase()}`;
      sub.textContent = id ? [row.id, meta.publish ? (row.published ? "published" : "draft") : null, row.is_deleted ? "deleted" : null,
        row.cover ? `cover ${row.cover}` : "no cover"].filter(Boolean).join(" · ") : "";
      actions.replaceChildren();
      if (!id) return;
      const act = (label, fn, cls = "btn btn-small btn-secondary") => {
        const b = h("button", { type: "button", class: cls });
        b.textContent = label;
        b.addEventListener("click", () => busy(b, msg, fn));
        actions.append(b);
      };
      const base = `${meta.path}/${encodeURIComponent(id)}`;
      if (meta.publish && !row.is_deleted) {
        if (row.published) act("Unpublish", async () => { row = await api.post("content", `${base}/unpublish`); paintHeader(); msg.ok("Unpublished."); });
        else act("Publish", async () => { row = await api.post("content", `${base}/publish`); paintHeader(); msg.ok("Published."); });
      }
      if (row.cover && !row.is_deleted) act("Clear cover", async () => { row = await api.patch("content", base, { cover: null }); paintHeader(); gallery?.setCover(row.cover); msg.ok("Cover cleared."); });
      if (row.is_deleted) act("Restore", async () => { row = await api.post("content", `${base}/restore`); paintHeader(); msg.ok("Restored."); });
      else act("Delete", async () => {
        if (!confirmFn(`Delete this ${meta.label.toLowerCase()}? It is a soft delete and can be restored.`)) return;
        await api.del("content", base);
        row = await api.get("content", base);
        paintHeader();
        msg.ok("Deleted (soft). Use Restore to undo.");
      }, "btn btn-small btn-danger");
    }
    paintHeader();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = Object.fromEntries(Object.entries(inputs).map(([k, fi]) => [k, fi.read()]));
      const result = id ? toPatchPayload(kind, raw, row) : toCreatePayload(kind, raw);
      for (const [name, fi] of Object.entries(inputs)) {
        if (!fi.err) continue;
        fi.err.textContent = result.errors[name] ?? "";
        fi.err.hidden = !result.errors[name];
      }
      if (!result.ok) { msg.fail("Fix the highlighted fields."); return; }
      if (id && result.empty) { msg.ok("Nothing to change."); return; }
      void busy(save, msg, async () => {
        if (id) {
          row = await api.patch("content", `${meta.path}/${encodeURIComponent(id)}`, result.payload);
          paintHeader();
          msg.ok("Saved.");
        } else {
          const path = kind === "spot" ? `/v1/admin/places/${encodeURIComponent(ctx.placeId)}/spots` : meta.path;
          const created = await api.post("content", path, result.payload);
          await showEntity(kind, created.id, ctx);
        }
      });
    });

    let gallery = null;
    if (id) {
      gallery = renderGallery({ parentType: meta.parentType, parentId: id, coverId: row.cover, token, onCover: (coverId) => { row = { ...row, cover: coverId }; paintHeader(); } });
      view.append(gallery.node);
      if (kind === "place") view.append(await renderSpots(id, token));
      if (kind === "collection") view.append(await renderMembers(id, token));
    }
  }

  // ---------- spots of a place ----------
  async function renderSpots(placeId, token) {
    const msg = messageBox();
    const deleted = h("input", { type: "checkbox" });
    const tbody = h("tbody");
    let items = [];
    const section = h("section", { class: "panel" }, h("h3", {}, "Spots"),
      h("div", { class: "toolbar" }, h("label", { class: "check" }, deleted, " Show deleted"),
        h("button", { type: "button", class: "btn btn-small btn-secondary", onclick: () => showEntity("spot", null, { placeId, defaults: { position: String(nextPosition(items)), in_skim: true, in_detailed: true } }) }, "New spot")),
      ...msg.nodes,
      h("div", { class: "table-wrap" }, h("table", { class: "data" }, h("thead", {}, h("tr", {}, ["#", "Title", "Slug", "Skim", "Detailed", "Deleted", ""].map((c) => h("th", {}, c)))), tbody)));
    async function load() {
      try {
        const res = await api.get("content", `/v1/admin/places/${encodeURIComponent(placeId)}/spots`, { include_deleted: deleted.checked ? "true" : undefined });
        if (!isCurrent(token)) return;
        items = res?.items ?? [];
        tbody.replaceChildren(...items.map((s) => h("tr", { class: s.is_deleted ? "row-deleted" : undefined },
          h("td", {}, s.position), h("td", {}, s.title), h("td", {}, h("code", {}, s.slug)), h("td", {}, yesNo(s.in_skim)), h("td", {}, yesNo(s.in_detailed)), h("td", {}, yesNo(s.is_deleted)),
          h("td", {}, h("button", { type: "button", class: "btn-text", onclick: () => showEntity("spot", s.id, { placeId }) }, "Open")))));
        if (!items.length) tbody.append(h("tr", {}, h("td", { colspan: 7 }, "No spots yet.")));
        msg.clear();
      } catch (err) {
        if (isCurrent(token)) msg.fail(err);
      }
    }
    deleted.addEventListener("change", load);
    await load();
    return section;
  }

  // ---------- collection members ----------
  async function renderMembers(collectionId, token) {
    const msg = messageBox();
    const tbody = h("tbody");
    const results = h("ul", { class: "search-results" });
    const search = h("input", { type: "search", placeholder: "Find a place to add", "aria-label": "Find a place" });
    let members = [];
    const base = `/v1/admin/collections/${encodeURIComponent(collectionId)}/places`;
    const section = h("section", { class: "panel" }, h("h3", {}, "Places in this collection"), ...msg.nodes,
      h("div", { class: "table-wrap" }, h("table", { class: "data" }, h("thead", {}, h("tr", {}, ["Position", "Place", "Slug", "Published", ""].map((c) => h("th", {}, c)))), tbody)),
      h("form", { class: "toolbar", onsubmit: (e) => { e.preventDefault(); void find(); } }, search, h("button", { type: "submit", class: "btn btn-small btn-secondary" }, "Search")), results);

    async function load() {
      try {
        const res = await api.get("content", base);
        if (!isCurrent(token)) return;
        members = res?.items ?? [];
        tbody.replaceChildren(...members.map((m) => {
          const pos = h("input", { type: "text", inputmode: "numeric", class: "pos", value: String(m.position), "aria-label": `Position of ${m.name}` });
          const saveBtn = h("button", { type: "button", class: "btn-text" }, "Save position");
          saveBtn.addEventListener("click", () => {
            const p = parsePosition(pos.value);
            if (p.error) { msg.fail(`Position: ${p.error}`); return; }
            void busy(saveBtn, msg, async () => { await api.put("content", `${base}/${encodeURIComponent(m.place_id)}`, { position: p.value }); await load(); msg.ok("Position saved."); });
          });
          const rm = h("button", { type: "button", class: "btn-text danger" }, "Remove");
          rm.addEventListener("click", () => {
            if (!confirmFn(`Remove ${m.name} from this collection?`)) return;
            void busy(rm, msg, async () => { await api.del("content", `${base}/${encodeURIComponent(m.place_id)}`); await load(); msg.ok("Removed."); });
          });
          return h("tr", { class: m.is_deleted ? "row-deleted" : undefined }, h("td", {}, pos), h("td", {}, m.name), h("td", {}, h("code", {}, m.slug)), h("td", {}, yesNo(m.published)), h("td", {}, saveBtn, " ", rm));
        }));
        if (!members.length) tbody.append(h("tr", {}, h("td", { colspan: 5 }, "No places yet.")));
      } catch (err) {
        if (isCurrent(token)) msg.fail(err);
      }
    }
    async function find() {
      const q = search.value.trim();
      if (!q) { results.replaceChildren(); return; }
      try {
        const res = await api.get("content", "/v1/admin/places", { q, limit: 10 });
        if (!isCurrent(token)) return;
        const inSet = new Set(members.map((m) => m.place_id));
        results.replaceChildren(...(res?.items ?? []).map((p) => {
          const add = h("button", { type: "button", class: "btn-text", disabled: inSet.has(p.id) }, inSet.has(p.id) ? "Added" : "Add");
          add.addEventListener("click", () => busy(add, msg, async () => {
            await api.put("content", `${base}/${encodeURIComponent(p.id)}`, { position: nextPosition(members) });
            await load();
            results.replaceChildren();
            msg.ok(`Added ${p.name}.`);
          }));
          return h("li", {}, `${p.name} `, h("code", {}, p.slug), " ", add);
        }));
        if (!results.children.length) results.append(h("li", {}, "No matching places."));
      } catch (err) {
        if (isCurrent(token)) msg.fail(err);
      }
    }
    await load();
    return section;
  }

  // ---------- image gallery (bk-media, spec 017) ----------
  function renderGallery({ parentType, parentId, coverId, token, onCover }) {
    const msg = messageBox();
    const grid = h("ul", { class: "gallery" });
    const deleted = h("input", { type: "checkbox" });
    const file = h("input", { type: "file", accept: IMAGE_TYPES.join(","), "aria-label": "Image file" });
    const uploadBtn = h("button", { type: "button", class: "btn btn-small" }, "Upload");
    let items = [];
    let cover = coverId ?? null;
    let polling = false;
    const listQuery = { parent_type: parentType, parent_id: parentId };
    const node = h("section", { class: "panel" }, h("h3", {}, "Images"),
      h("div", { class: "toolbar" }, file, uploadBtn, h("label", { class: "check" }, deleted, " Show deleted")),
      h("p", { class: "meta" }, "JPEG, PNG or WebP up to 10 MB. New images show \u201cprocessing\u201d until resized."),
      ...msg.nodes, grid);

    async function list() {
      const live = (await api.get("media", "/v1/admin/images", listQuery))?.items ?? [];
      if (!deleted.checked) return live;
      const all = (await api.get("media", "/v1/admin/images", { ...listQuery, include_deleted: "true" }))?.items ?? [];
      const liveIds = new Set(live.map((i) => i.id));
      return all.map((i) => ({ ...i, is_deleted: !liveIds.has(i.id) }));
    }

    function paint() {
      grid.replaceChildren(...items.map((img) => {
        const card = h("li", { class: `image-card${img.is_deleted ? " row-deleted" : ""}` });
        const thumb = img.status === "ready" && img.urls?.["320"]
          ? h("img", { src: img.urls["320"], alt: "", loading: "lazy", width: 160, height: 120 })
          : h("div", { class: "thumb-placeholder" }, img.status === "failed" ? "failed" : "processing");
        const labels = [img.id === cover ? "cover" : null, img.is_deleted ? "deleted" : img.status, img.width && img.height ? `${img.width}×${img.height}` : null].filter(Boolean).join(" · ");
        const btn = (label, fn, cls = "btn-text") => {
          const b = h("button", { type: "button", class: cls }, label);
          b.addEventListener("click", () => busy(b, msg, fn));
          return b;
        };
        const controls = h("div", { class: "image-actions" });
        if (img.is_deleted) {
          controls.append(btn("Restore", async () => { await api.post("media", `/v1/admin/images/${encodeURIComponent(img.id)}/restore`); await refresh(); msg.ok("Image restored. Its files may be gone; re-upload if it does not show."); }));
        } else {
          controls.append(...[
            btn("↑", () => reorder(img.id, -1)),
            btn("↓", () => reorder(img.id, 1)),
            img.status === "ready" && img.id !== cover ? btn("Set cover", async () => {
              const res = await api.post("media", `/v1/admin/images/${encodeURIComponent(img.id)}/cover`);
              cover = res?.cover_image_id ?? img.id;
              onCover?.(cover);
              paint();
              msg.ok("Cover set.");
            }) : null,
            btn("Delete", async () => {
              if (!confirmFn("Delete this image? Its files are removed from storage. Restore brings back the record only.")) return;
              await api.del("media", `/v1/admin/images/${encodeURIComponent(img.id)}`);
              if (img.id === cover) { cover = null; onCover?.(null); }
              await refresh();
              msg.ok("Image deleted.");
            }, "btn-text danger"),
          ].filter(Boolean));
        }
        card.append(...[thumb, h("p", { class: "meta" }, labels), img.status === "failed" && img.error ? h("p", { class: "error-inline" }, img.error) : null, controls].filter(Boolean));
        return card;
      }));
      if (!items.length) grid.append(h("li", { class: "meta" }, "No images yet."));
    }

    async function reorder(id, delta) {
      const ordered = moveImage(items, id, delta);
      if (!ordered) return;
      const res = await api.put("media", "/v1/admin/images/reorder", { ...listQuery, ordered_ids: ordered });
      await refresh(res?.items);
    }

    async function refresh(preset) {
      items = preset && !deleted.checked ? preset : await list();
      if (!isCurrent(token)) return;
      paint();
      if (hasPending(items)) void poll();
    }

    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const out = await pollImages({ list, isCancelled: () => !isCurrent(token), onUpdate: (next) => { if (isCurrent(token)) { items = next; paint(); } }, ...(sleep ? { sleep } : {}) });
        if (out.timedOut && isCurrent(token)) msg.ok("Some images are still processing. Refresh later.");
      } catch (err) {
        if (isCurrent(token)) msg.fail(err);
      } finally {
        polling = false;
      }
    }

    uploadBtn.addEventListener("click", () => {
      const f = file.files?.[0];
      const invalid = validateImageFile(f);
      if (invalid) { msg.fail(invalid); return; }
      void busy(uploadBtn, msg, async () => {
        try {
          await uploadImage({ api, fetchImpl, parentType, parentId, file: f, onStep: (s) => msg.ok({ presign: "Preparing upload…", upload: "Uploading…", complete: "Confirming…" }[s]) });
        } catch (err) {
          if (err instanceof UploadError) {
            msg.fail(`${err.message}: ${formatApiError(err.cause)}`);
            if (err.step !== "presign") await refresh().catch(() => {});
            return;
          }
          throw err;
        }
        file.value = "";
        msg.ok("Uploaded. Processing…");
        await refresh();
      });
    });
    deleted.addEventListener("change", () => { void refresh().catch((err) => msg.fail(err)); });
    void refresh().catch((err) => { if (isCurrent(token)) msg.fail(err); });

    return { node, setCover(id) { cover = id ?? null; paint(); } };
  }

  void showList("place");

  return {
    unmount() {
      alive = false;
      viewToken += 1;
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
