/** Quick create (store-listing 001 increment 4): small modals for a new place, spot, collection or voice. */
import { h, busy, field, openModal, slugify } from "./dom.js";
import { ENTITIES, nextPosition, parseField, toCreatePayload } from "../forms.js";
import { SECTION_OF } from "./route.js";

const fieldOf = (kind, name) => ENTITIES[kind].fields.find((f) => f.name === name);
const VOICE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validates the voice quick-create values. Returns { ok, payload, errors }. */
export function voiceCreatePayload({ display_name, slug, gender }) {
  const errors = {};
  const name = String(display_name ?? "").trim();
  const s = String(slug ?? "").trim();
  if (!name) errors.display_name = "Required";
  else if (name.length > 100) errors.display_name = "At most 100 characters";
  if (!s) errors.slug = "Required";
  else if (s.length > 60 || !VOICE_SLUG.test(s)) errors.slug = "Lower-case words joined by -, max 60";
  if (!["female", "male"].includes(gender)) errors.gender = "Pick one";
  const ok = !Object.keys(errors).length;
  return { ok, errors, payload: ok ? { slug: s, display_name: name, gender } : null };
}

/**
 * Opens the quick-create modal for `kind`. `preset` may carry { place_id } for a spot.
 * On success navigates to the new record (Media tab for content, so images come next).
 */
export function quickCreate(ctx, kind, preset = {}) {
  const { api, toast } = ctx;
  const title = { place: "New place", spot: "New spot", collection: "New collection", voice: "New voice" }[kind];
  return openModal(ctx.modalHost, {
    title,
    build(close) {
      const errs = {};
      const nameKey = kind === "spot" ? "title" : kind === "voice" ? "display_name" : "name";
      const name = h("input", { type: "text", maxlength: kind === "voice" ? "100" : "200", autocomplete: "off" });
      const slug = h("input", { type: "text", maxlength: kind === "voice" ? "60" : "100", autocomplete: "off" });
      let slugTouched = false;
      name.addEventListener("input", () => { if (!slugTouched) slug.value = slugify(name.value).slice(0, kind === "voice" ? 60 : 100); });
      slug.addEventListener("input", () => { slugTouched = slug.value !== ""; });
      errs[nameKey] = field(kind === "spot" ? "Title" : kind === "voice" ? "Display name" : "Name", name, { required: true });
      errs.slug = field("Slug", slug, { required: true, hint: "Lower-case words joined by -. Used in URLs." });
      const nodes = [errs[nameKey].node, errs.slug.node];
      let state;
      let city;
      let placeSel;
      let gender;
      if (kind === "place" || kind === "collection") {
        state = h("select", {}, h("option", { value: "" }, "Loading states…"));
        errs.state_id = field("State", state, { required: true });
        nodes.push(errs.state_id.node);
        void ctx.loadStates().then((states) => {
          state.replaceChildren(h("option", { value: "" }, "Pick a state"), ...states.map((s) => h("option", { value: s.id }, s.name)));
        }).catch((err) => toast.error(err));
      }
      if (kind === "place") {
        city = h("input", { type: "text", maxlength: "200" });
        errs.city = field("City", city);
        nodes.push(errs.city.node);
      }
      if (kind === "spot") {
        placeSel = h("select", {}, h("option", { value: "" }, "Loading places…"));
        errs.place_id = field("Place", placeSel, { required: true });
        nodes.unshift(errs.place_id.node);
        void api.get("content", "/v1/admin/places", { limit: 200, sort: "name" }).then((res) => {
          placeSel.replaceChildren(h("option", { value: "" }, "Pick a place"), ...(res?.items ?? []).map((p) => h("option", { value: p.id }, p.name)));
          if (preset.place_id) placeSel.value = preset.place_id;
        }).catch((err) => toast.error(err));
      }
      if (kind === "voice") {
        gender = h("select", {}, h("option", { value: "" }, "Pick one"), h("option", { value: "female" }, "Female"), h("option", { value: "male" }, "Male"));
        errs.gender = field("Gender", gender, { required: true });
        nodes.push(errs.gender.node);
      }
      const submit = h("button", { type: "submit", class: "btn" }, "Create");
      const cancel = h("button", { type: "button", class: "btn-text", onclick: close }, "Cancel");
      const form = h("form", { class: "quick-create", novalidate: true }, nodes, h("div", { class: "actions" }, submit, cancel));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        for (const f of Object.values(errs)) f.setError("");
        void (async () => {
          let out;
          let path;
          let section = SECTION_OF[kind];
          if (kind === "voice") {
            out = voiceCreatePayload({ display_name: name.value, slug: slug.value, gender: gender.value });
            path = ["media", "/v1/admin/voices"];
          } else if (kind === "spot") {
            const t = parseField(fieldOf("spot", "title"), name.value);
            const s = parseField(fieldOf("spot", "slug"), slug.value);
            const errors = {};
            if (t.error) errors.title = t.error;
            if (s.error) errors.slug = s.error;
            if (!placeSel.value) errors.place_id = "Pick a place";
            out = { ok: !Object.keys(errors).length, errors, payload: { title: t.value, slug: s.value, in_skim: true, in_detailed: true } };
            path = ["content", `/v1/admin/places/${encodeURIComponent(placeSel.value)}/spots`];
          } else {
            const values = { name: name.value, slug: slug.value, state_id: state.value, city: city?.value ?? "", published: false };
            out = toCreatePayload(kind, values);
            path = ["content", ENTITIES[kind].path];
          }
          if (!out.ok) {
            for (const [k, m] of Object.entries(out.errors)) errs[k]?.setError(m);
            return;
          }
          await busy(submit, toast, async () => {
            if (kind === "spot") {
              const spots = (await api.get("content", `/v1/admin/places/${encodeURIComponent(placeSel.value)}/spots`))?.items ?? [];
              out.payload.position = nextPosition(spots);
            }
            const created = await api.post(path[0], path[1], out.payload);
            close();
            toast.ok(`${title.replace("New ", "")[0].toUpperCase()}${title.replace("New ", "").slice(1)} created.`);
            ctx.navigate({ section, id: created.id, tab: kind === "voice" ? "details" : "media" }, { force: true });
          });
        })();
      });
      return form;
    },
  });
}
