/**
 * Media tab (store-listing 001 increment 4; docs spec 020). Assets of one parent grouped by type.
 * Only images are enabled now; video is listed in MEDIA_TYPES as a later slot and has no UI.
 */
import { formatApiError } from "../api.js";
import { h, busy, emptyState, fmtBytes } from "./dom.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, hasPending, moveImage, pollImages, uploadImage, validateImageFile, xhrPut } from "../upload.js";

export const MEDIA_TYPES = Object.freeze([
  { type: "image", label: "Images", enabled: true, accept: IMAGE_TYPES.join(","), hint: "JPEG, PNG or WebP up to 10 MB each. Drop several at once." },
  { type: "video", label: "Video clips", enabled: false, hint: "Coming later." },
]);
const CAPTION_MAX = 500;

/** Splits dropped/selected files into accepted and rejected (with reasons). */
export function partitionFiles(files) {
  const ok = [];
  const rejected = [];
  for (const f of Array.from(files ?? [])) {
    const why = validateImageFile(f);
    if (why) rejected.push({ file: f, reason: why });
    else ok.push(f);
  }
  return { ok, rejected };
}

/**
 * ctx: { api, toast, confirmFn, fetchImpl, putImpl, sleep, isCurrent(token) }.
 * Returns { node }. `onCover(id|null)` is called when the cover changes.
 */
export function renderMedia(ctx, { parentType, parentId, cover: initialCover, onCover }, token) {
  const { api, toast, confirmFn } = ctx;
  let cover = initialCover ?? null;
  let items = [];
  let polling = false;
  const listQuery = { parent_type: parentType, parent_id: parentId };
  const grid = h("ul", { class: "media-grid", "aria-label": "Images" });
  const queue = h("ul", { class: "upload-queue", "aria-live": "polite" });
  const deleted = h("input", { type: "checkbox" });
  const input = h("input", { type: "file", accept: MEDIA_TYPES[0].accept, multiple: true, class: "visually-hidden", id: `media-file-${parentId}` });
  const drop = h("label", { class: "dropzone", for: input.id, tabindex: "0" },
    h("strong", {}, "Drop images here"), h("span", { class: "meta" }, " or click to choose files"));
  const summary = h("p", { class: "meta media-summary" });

  const sections = MEDIA_TYPES.map((t) => t.enabled
    ? h("section", { class: "panel media-section", "data-type": t.type },
      h("div", { class: "panel-head" }, h("h3", {}, t.label), h("label", { class: "check" }, deleted, " Show deleted")),
      h("p", { class: "meta" }, t.hint), drop, input, queue, grid)
    : null);
  const node = h("div", { class: "media-tab" }, summary, ...sections);

  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragging"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); void uploadMany(e.dataTransfer?.files); });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { const files = input.files; void uploadMany(files).then(() => { input.value = ""; }); });
  deleted.addEventListener("change", () => void refresh());

  async function list() {
    const live = (await api.get("media", "/v1/admin/images", listQuery))?.items ?? [];
    if (!deleted.checked) return live;
    const all = (await api.get("media", "/v1/admin/images", { ...listQuery, include_deleted: "true" }))?.items ?? [];
    const liveIds = new Set(live.map((i) => i.id));
    return all.map((i) => ({ ...i, is_deleted: !liveIds.has(i.id) }));
  }

  async function uploadMany(files) {
    const { ok, rejected } = partitionFiles(files);
    for (const r of rejected) toast.error(`${r.file?.name ?? "File"}: ${r.reason}`);
    if (!ok.length) return;
    const putImpl = ctx.putImpl ?? (globalThis.XMLHttpRequest ? xhrPut : undefined);
    let done = 0;
    // Two at a time keeps the browser responsive and stays well under the API rate limit.
    const work = ok.map((file) => async () => {
      const bar = h("progress", { max: "100", value: "0", "aria-label": `Uploading ${file.name}` });
      const state = h("span", { class: "meta" }, "Waiting…");
      const row = h("li", { class: "upload-row" }, h("span", { class: "upload-name" }, file.name), h("span", { class: "meta" }, fmtBytes(file.size)), bar, state);
      queue.append(row);
      try {
        await uploadImage({
          api, fetchImpl: ctx.fetchImpl, putImpl, parentType, parentId, file,
          onStep: (s) => { state.textContent = { presign: "Preparing…", upload: "Uploading…", complete: "Confirming…" }[s]; },
          onProgress: (f) => { bar.value = Math.round(f * 100); },
        });
        bar.value = 100;
        state.textContent = "Uploaded";
        row.classList.add("upload-done");
        done += 1;
        setTimeout(() => row.remove(), 4000);
      } catch (err) {
        state.textContent = "Failed";
        row.classList.add("upload-failed");
        toast.error(`${file.name}: ${err?.message ?? "Upload failed"}${err?.cause ? ` (${formatApiError(err.cause)})` : ""}`);
      }
    });
    const runners = Array.from({ length: Math.min(2, work.length) }, async () => {
      while (work.length) await work.shift()();
    });
    await Promise.all(runners);
    if (done) toast.ok(done === 1 ? "Image uploaded. Resizing…" : `${done} images uploaded. Resizing…`);
    if (ctx.isCurrent(token)) await refresh();
  }

  function paint() {
    const live = items.filter((i) => !i.is_deleted);
    summary.textContent = `${live.length} image${live.length === 1 ? "" : "s"}${cover ? " · cover set" : " · no cover"}`;
    grid.replaceChildren(...items.map((img, idx) => {
      const thumb = img.status === "ready" && img.urls?.["320"]
        ? h("img", { src: img.urls["320"], alt: img.caption ?? "", loading: "lazy", width: 200, height: 150 })
        : h("div", { class: "thumb-placeholder" }, img.status === "failed" ? "Failed" : "Processing…");
      const caption = h("input", { type: "text", maxlength: String(CAPTION_MAX), placeholder: "Caption", value: img.caption ?? "", "aria-label": "Caption", disabled: img.is_deleted });
      caption.addEventListener("change", () => void busy(null, toast, async () => {
        const text = caption.value.trim();
        await api.patch("media", `/v1/admin/images/${encodeURIComponent(img.id)}`, { caption: text || null });
        img.caption = text || null;
        toast.ok("Caption saved.");
      }));
      const btn = (label, fn, cls = "btn-text", extra = {}) => {
        const b = h("button", { type: "button", class: cls, ...extra }, label);
        b.addEventListener("click", () => void busy(b, toast, fn));
        return b;
      };
      const actions = h("div", { class: "image-actions" });
      if (img.is_deleted) {
        actions.append(btn("Restore", async () => {
          await api.post("media", `/v1/admin/images/${encodeURIComponent(img.id)}/restore`);
          await refresh();
          toast.ok("Image restored. Re-upload it if the files are gone.");
        }));
      } else {
        actions.append(...[
          btn("←", () => reorder(img.id, -1), "btn-text", { "aria-label": "Move earlier", disabled: idx === 0 }),
          btn("→", () => reorder(img.id, 1), "btn-text", { "aria-label": "Move later" }),
          img.status === "ready" && img.id !== cover ? btn("Set cover", async () => {
            const res = await api.post("media", `/v1/admin/images/${encodeURIComponent(img.id)}/cover`);
            cover = res?.cover_image_id ?? img.id;
            onCover?.(cover);
            paint();
            toast.ok("Cover set.");
          }) : null,
          btn("Delete", async () => {
            if (!confirmFn("Delete this image? Its files are removed from storage.")) return;
            await api.del("media", `/v1/admin/images/${encodeURIComponent(img.id)}`);
            if (img.id === cover) { cover = null; onCover?.(null); }
            await refresh();
            toast.ok("Image deleted.");
          }, "btn-text danger"),
        ].filter(Boolean));
      }
      const meta = [img.status !== "ready" ? img.status : null, img.width && img.height ? `${img.width}×${img.height}` : null, fmtBytes(img.bytes)].filter(Boolean).join(" · ");
      return h("li", { class: `media-card${img.is_deleted ? " row-deleted" : ""}${img.id === cover ? " is-cover" : ""}`, "data-id": img.id },
        h("div", { class: "media-thumb" }, thumb, img.id === cover ? h("span", { class: "cover-flag" }, "Cover") : null),
        caption, h("p", { class: "meta" }, meta), img.status === "failed" && img.error ? h("p", { class: "error-inline" }, img.error) : null, actions);
    }));
    if (!items.length) grid.append(h("li", { class: "media-empty" }, emptyState("No images yet.", "Drop photos above. The first ready one is a good cover.")));
  }

  async function reorder(id, delta) {
    const ordered = moveImage(items, id, delta);
    if (!ordered) return;
    const res = await api.put("media", "/v1/admin/images/reorder", { ...listQuery, ordered_ids: ordered });
    await refresh(res?.items);
  }

  async function refresh(preset) {
    try {
      items = preset && !deleted.checked ? preset : await list();
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    paint();
    if (hasPending(items)) void poll();
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const out = await pollImages({ list, isCancelled: () => !ctx.isCurrent(token), onUpdate: (next) => { if (ctx.isCurrent(token)) { items = next; paint(); } }, ...(ctx.sleep ? { sleep: ctx.sleep } : {}) });
      if (out.timedOut && ctx.isCurrent(token)) toast.info("Some images are still processing. Refresh later.");
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
    } finally {
      polling = false;
    }
  }

  void refresh();
  return { node, refresh, uploadMany, setCover: (id) => { cover = id; paint(); } };
}

export { MAX_IMAGE_BYTES };
