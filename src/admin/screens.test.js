// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";
import { mountAdminTools, UNSAVED_PROMPT } from "./screens.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 10) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const PLACE = { id: "plc_AbCdEfGhIjKl", state_id: "ste_AbCdEfGhIjKl", slug: "hampi", name: "Hampi", city: "Hosapete", summary: null, cover: null, latitude: 15.3, longitude: 76.4, skim_minutes: 30, detailed_minutes: null, published: false, is_deleted: false,
  state_name: "Karnataka", stats: { image_count: 2, spot_count: 1, scripts: { kan: ["skim", "detailed"] }, audio_ready_count: 1, audio_live_count: 1 } };
const STATES = [{ id: PLACE.state_id, name: "Karnataka" }];
const LANGS = [{ code: "kan", name: "Kannada", is_deleted: false }, { code: "eng", name: "English", is_deleted: false }];
const OPTIONS = {
  provider: "elevenlabs", key_configured: false, key_param: "elevenlabs/api-key", default_model_id: "eleven_multilingual_v2",
  models: [{ model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_use_style: true, can_use_speaker_boost: true }, { model_id: "eleven_flash_v2_5", name: "Flash", can_use_style: false, can_use_speaker_boost: false }],
  models_source: "static", output_formats: ["mp3_44100_128", "mp3_44100_192", "wav_44100", "opus_48000_64"], default_output_format: "mp3_44100_128",
  voice_settings: { stability: { min: 0, max: 1, step: 0.01, default: 0.5 }, similarity_boost: { min: 0, max: 1, step: 0.01, default: 0.75 }, style: { min: 0, max: 1, step: 0.01, default: 0 }, speed: { min: 0.7, max: 1.2, step: 0.01, default: 1 }, use_speaker_boost: { default: true } },
  apply_text_normalization: ["auto", "on", "off"], language_codes: { kan: "kn", eng: "en" },
};

function client(routes) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    calls.push({ key, u, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[key];
    if (!handler) return json(404, { error: { code: "route_not_found", message: `No mock for ${key}` } });
    return handler(u, init);
  });
  const api = createApiClient({ bases: { content: "https://c.example/dev", media: "https://m.example/dev" }, getToken: async () => "tok", fetchImpl });
  return { api, fetchImpl, calls };
}

const common = {
  "GET /dev/v1/admin/states": () => json(200, { items: STATES }),
  "GET /dev/v1/admin/countries": () => json(200, { items: [{ id: "cty_AbCdEfGhIjKl", name: "India" }] }),
  "GET /dev/v1/admin/script-languages": () => json(200, { items: LANGS }),
  "GET /dev/v1/admin/tts/options": () => json(200, OPTIONS),
  "GET /dev/v1/admin/places": () => json(200, { items: [PLACE], total: 30, limit: 25, offset: 0 }),
  [`GET /dev/v1/admin/places/${PLACE.id}`]: () => json(200, PLACE),
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((el) => el.textContent.trim() === text);

describe("CRM admin console", () => {
  let root;
  let tools;
  beforeEach(() => {
    window.location.hash = "";
    document.body.innerHTML = '<section id="t" hidden></section>';
    root = document.getElementById("t");
  });
  afterEach(() => { tools?.unmount(); tools = null; });

  it("shows the left nav and a places list with filters, badges, pagination and error toasts", async () => {
    const { api, calls } = client({
      ...common,
      "GET /dev/v1/admin/places": (u) => (u.searchParams.get("q") === "boom"
        ? json(403, { error: { code: "forbidden", message: "Requires the admin role" } })
        : json(200, { items: [PLACE], total: 30, limit: 25, offset: 0 })),
    });
    tools = mountAdminTools(root, { api, cdn: "https://cdn.example" });
    await flush();
    expect(root.hidden).toBe(false);
    expect([...root.querySelectorAll(".crm-nav-link")].map((a) => a.textContent)).toEqual(["Places", "Spots", "Collections", "Voices"]);
    expect(root.querySelector('.crm-nav-link[aria-current="page"]').textContent).toBe("Places");
    expect(root.querySelector("tbody").textContent).toContain("Hampi");
    expect(root.querySelector("tbody").textContent).toContain("Karnataka");
    expect(root.querySelector(".pager").textContent).toContain("1–1 of 30");
    const badges = [...root.querySelectorAll("tbody .badge")].map((b) => b.textContent);
    expect(badges).toEqual(expect.arrayContaining(["Cover", "2 img", "1 spots", "kan SD", "eng ––", "1 live audio"]));
    expect(root.querySelector("tbody .badge").className).toContain("badge-missing");
    const first = calls.find((c) => c.key === "GET /dev/v1/admin/places");
    expect(first.u.searchParams.get("limit")).toBe("25");
    expect(first.u.searchParams.get("sort")).toBeNull();

    const cover = root.querySelector('[data-filter="has_cover"]');
    cover.value = "false";
    cover.dispatchEvent(new Event("change"));
    const sort = root.querySelector('select[aria-label="Sort"]');
    sort.value = "name";
    sort.dispatchEvent(new Event("change"));
    await flush();
    const last = calls.filter((c) => c.key === "GET /dev/v1/admin/places").at(-1);
    expect(last.u.searchParams.get("has_cover")).toBe("false");
    expect(last.u.searchParams.get("sort")).toBe("name");
    expect(root.querySelector('[data-filter="country_id"]').textContent).toContain("India");

    root.querySelector('input[type="search"]').value = "boom";
    root.querySelector("form.list-toolbar").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(root.querySelector('.toast[role="alert"]').textContent).toContain("Requires the admin role (forbidden)");

    tools.unmount();
    tools = null;
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it("shows an empty state with a create button when nothing exists", async () => {
    const { api } = client({ ...common, "GET /dev/v1/admin/collections": () => json(200, { items: [], total: 0 }) });
    window.location.hash = "#/collections";
    tools = mountAdminTools(root, { api });
    await flush();
    expect(root.querySelector(".empty-state").textContent).toContain("No collections yet.");
    expect(byText(root, ".empty-state button", "New collection")).toBeTruthy();
  });

  it("opens a place on Details, saves only changed fields, publishes, and guards unsaved changes", async () => {
    const patches = [];
    const confirmFn = vi.fn(() => false);
    const { api } = client({
      ...common,
      [`PATCH /dev/v1/admin/places/${PLACE.id}`]: (_u, init) => { patches.push(JSON.parse(init.body)); return json(200, { ...PLACE, ...JSON.parse(init.body) }); },
      [`POST /dev/v1/admin/places/${PLACE.id}/publish`]: () => json(200, { ...PLACE, published: true }),
    });
    tools = mountAdminTools(root, { api, confirmFn });
    await flush();
    root.querySelector(`tr[data-id="${PLACE.id}"]`).click();
    await flush();
    expect(window.location.hash).toBe(`#/places/${PLACE.id}`);
    expect(root.querySelector(".record-head h2").textContent).toBe("Hampi");
    expect([...root.querySelectorAll(".tabs .tab")].map((t) => t.textContent)).toEqual(["Details", "Media", "Spots", "Scripts", "Audio"]);
    expect(root.querySelector('.tab[aria-selected="true"]').textContent).toBe("Details");
    const save = byText(root, "button", "Save changes");
    expect(save.disabled).toBe(true);

    const city = root.querySelector('input[name="city"]');
    city.value = "Hampi town";
    city.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);

    // Leaving with unsaved changes asks first; "Cancel" keeps the user here.
    tools.navigate({ section: "spots" });
    expect(confirmFn).toHaveBeenCalledWith(UNSAVED_PROMPT);
    await flush();
    expect(root.querySelector(".record-head h2").textContent).toBe("Hampi");

    // Inline validation.
    const lat = root.querySelector('input[name="latitude"]');
    lat.value = "200";
    lat.dispatchEvent(new Event("blur"));
    expect(lat.closest(".field").querySelector(".field-error").textContent).toBe("Must be between -90 and 90");
    lat.value = "15.3";
    lat.dispatchEvent(new Event("input"));

    root.querySelector("form.details-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(patches).toEqual([{ city: "Hampi town" }]);
    expect(root.querySelector(".toast").textContent).toContain("Saved.");

    byText(root, ".record-actions button", "Publish").click();
    await flush();
    expect(root.querySelector(".status-row").textContent).toContain("Published");
  });

  it("Media tab: drag-and-drop multi-file upload with progress, captions and set cover", async () => {
    let images = [{ id: "img_AaAaAaAaAaAa", status: "ready", urls: { 320: "https://cdn/x/320.webp" }, caption: null, is_deleted: false, width: 800, height: 600 }];
    const presigned = [];
    const patches = [];
    const { api } = client({
      ...common,
      "GET /dev/v1/admin/images": () => json(200, { items: images }),
      "POST /dev/v1/admin/images/presign": (_u, init) => {
        const b = JSON.parse(init.body);
        presigned.push(b);
        return json(201, { id: `img_New${presigned.length}xxxxxxx`.slice(0, 16), upload_url: `https://s3.example/u${presigned.length}`, headers: { "Content-Type": b.content_type } });
      },
      "POST /dev/v1/admin/images/img_New1xxxxxxx/complete": () => { images = [...images, { id: "img_New1xxxxxxx", status: "ready", urls: {}, is_deleted: false }]; return json(200, {}); },
      "POST /dev/v1/admin/images/img_New2xxxxxxx/complete": () => { images = [...images, { id: "img_New2xxxxxxx", status: "ready", urls: {}, is_deleted: false }]; return json(200, {}); },
      "PATCH /dev/v1/admin/images/img_AaAaAaAaAaAa": (_u, init) => { patches.push(JSON.parse(init.body)); return json(200, {}); },
      "POST /dev/v1/admin/images/img_AaAaAaAaAaAa/cover": () => json(200, { cover_image_id: "img_AaAaAaAaAaAa" }),
    });
    const progress = [];
    const putImpl = vi.fn(async (url, headers, file, onProgress) => { onProgress(0.5); progress.push(url); onProgress(1); return { ok: true, status: 200 }; });
    window.location.hash = `#/places/${PLACE.id}/media`;
    tools = mountAdminTools(root, { api, putImpl });
    await flush();
    expect(root.querySelector('.tab[aria-selected="true"]').textContent).toBe("Media");
    expect(root.querySelector(".media-section[data-type=image]")).toBeTruthy();
    expect(root.querySelector(".media-section[data-type=video]")).toBeNull();

    const files = [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.png", { type: "image/png" }),
      new File(["c"], "c.gif", { type: "image/gif" }),
    ];
    const drop = new Event("drop", { cancelable: true });
    drop.dataTransfer = { files };
    root.querySelector(".dropzone").dispatchEvent(drop);
    await flush(20);
    expect(presigned.map((p) => p.content_type)).toEqual(["image/jpeg", "image/png"]);
    expect(putImpl).toHaveBeenCalledTimes(2);
    expect(putImpl.mock.calls[0][1]).toEqual({ "Content-Type": "image/jpeg" });
    expect([...root.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")).toMatch(/c\.gif/);
    expect([...root.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")).toContain("2 images uploaded");
    expect(root.querySelectorAll(".media-card")).toHaveLength(3);

    const caption = root.querySelector('.media-card[data-id="img_AaAaAaAaAaAa"] input[aria-label="Caption"]');
    caption.value = "Stone chariot";
    caption.dispatchEvent(new Event("change"));
    await flush();
    expect(patches).toEqual([{ caption: "Stone chariot" }]);

    byText(root, '.media-card[data-id="img_AaAaAaAaAaAa"] button', "Set cover").click();
    await flush();
    expect(root.querySelector(".status-row").textContent).toContain("Cover set");
    expect(root.querySelector('.media-card[data-id="img_AaAaAaAaAaAa"]').classList.contains("is-cover")).toBe(true);
  });

  it("Scripts tab: language chips, skim + detailed editors, save makes a version and marks dirty state", async () => {
    let scripts = [{ id: "scr_SkimSkimSkim", place_id: PLACE.id, language: "kan", format: "skim", version: 2, is_deleted: false }];
    const puts = [];
    const confirmFn = vi.fn(() => true);
    const { api } = client({
      ...common,
      "GET /dev/v1/admin/scripts": () => json(200, { items: scripts }),
      "GET /dev/v1/admin/scripts/scr_SkimSkimSkim": () => json(200, { ...scripts[0], content: "Old skim", updated_at: "2026-11-10T05:00:00Z" }),
      "PUT /dev/v1/admin/scripts": (_u, init) => {
        const b = JSON.parse(init.body);
        puts.push(b);
        scripts = [...scripts, { id: "scr_DetDetDetDet", language: b.language, format: b.format, version: 1, is_deleted: false }];
        return json(200, { script: { id: "scr_DetDetDetDet", version: 1, updated_at: "2026-11-10T06:00:00Z" }, changed: true });
      },
    });
    window.location.hash = `#/places/${PLACE.id}/scripts`;
    tools = mountAdminTools(root, { api, confirmFn });
    await flush(14);
    const chips = [...root.querySelectorAll(".lang-chips .chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["Kannada ½", "English"]);
    expect(root.querySelector('textarea[aria-label="skim script"]').value).toBe("Old skim");
    expect(root.querySelector(".script-version").textContent).toContain("Version 2");
    const detailed = root.querySelector('textarea[aria-label="detailed script"]');
    detailed.value = "  The full story of Hampi.  ";
    detailed.dispatchEvent(new Event("input"));
    expect(root.querySelector(".dirty-flag:not([hidden])")).toBeTruthy();
    expect(tools.ctx.isDirty()).toBe(true);
    byText(root, "button", "Save detailed").click();
    await flush(10);
    expect(puts).toEqual([{ place_id: PLACE.id, language: "kan", format: "detailed", content: "The full story of Hampi." }]);
    expect(tools.ctx.isDirty()).toBe(false);
    expect(root.querySelector(".lang-chips .chip").textContent).toBe("Kannada ✓");

    byText(root, "button", "Generate audio →").click();
    await flush(2);
    expect(window.location.hash).toBe(`#/places/${PLACE.id}/audio`);
  });

  it("Audio tab: every ElevenLabs option goes into generate, takes poll until ready, then set live", async () => {
    const generated = [];
    let takes = [];
    const sleep = vi.fn(async () => {});
    const take = (over) => ({ id: "aud_TakeTakeTake", script_id: "scr_DetDetDetDet", script_version: 1, language: "kan", script_format: "detailed", status: "pending", is_live: false, voice_id: "vce_zYGnkRGptHgi", settings: { model_id: "eleven_multilingual_v2", output_format: "wav_44100", voice_settings: { stability: 0.3 } }, is_deleted: false, created_at: "2026-11-10T06:00:00Z", ...over });
    let polls = 0;
    const { api } = client({
      ...common,
      "GET /dev/v1/admin/scripts": () => json(200, { items: [{ id: "scr_DetDetDetDet", language: "kan", format: "detailed", version: 1, is_deleted: false }] }),
      "GET /dev/v1/admin/voices": () => json(200, { items: [{ id: "vce_zYGnkRGptHgi", display_name: "Padma", gender: "female", languages: [{ language: "kan", is_default: true }] }] }),
      "GET /dev/v1/admin/audio": () => {
        if (takes.length && takes[0].status !== "ready") { polls += 1; if (polls >= 2) takes = [take({ status: "ready", play_url: "https://s3.example/play.wav" })]; }
        return json(200, { items: takes });
      },
      "POST /dev/v1/audio/generate": (_u, init) => { generated.push(JSON.parse(init.body)); takes = [take()]; return json(202, { audio_id: "aud_TakeTakeTake", status: "pending", reused: false }); },
      "POST /dev/v1/admin/audio/aud_TakeTakeTake/live": () => { takes = [take({ status: "ready", is_live: true, play_url: "https://s3.example/play.wav" })]; return json(200, takes[0]); },
    });
    window.location.hash = `#/places/${PLACE.id}/audio`;
    tools = mountAdminTools(root, { api, sleep });
    await flush(16);
    const form = root.querySelector("form.tts-form");
    expect(form.textContent).toContain("elevenlabs/api-key");
    expect(form.querySelector('input[aria-label="Stability"]')).toBeTruthy();
    expect(root.querySelector(".takes .empty-state").textContent).toContain("No audio yet.");

    const set = (sel, value, ev = "change") => { const el = form.querySelector(sel); if (el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event(ev)); };
    set('input[aria-label="Stability value"]', "0.3");
    set('input[aria-label="Speed"]', "1.1", "input");
    const selects = [...form.querySelectorAll("select")];
    const outSel = selects.find((s) => [...s.options].some((o) => o.value === "wav_44100"));
    outSel.value = "wav_44100";
    outSel.dispatchEvent(new Event("change"));
    const voiceSel = selects.find((s) => [...s.options].some((o) => o.value === "vce_zYGnkRGptHgi"));
    voiceSel.value = "vce_zYGnkRGptHgi";
    voiceSel.dispatchEvent(new Event("change"));
    set('input[placeholder="random"]', "42", "input");
    set('textarea[placeholder^="dictionary_id"]', "dict1:v2\ndict2", "input");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush(20);
    expect(generated).toHaveLength(1);
    expect(generated[0]).toEqual({
      place_id: PLACE.id, language: "kan", format: "detailed", voice_id: "vce_zYGnkRGptHgi",
      settings: {
        model_id: "eleven_multilingual_v2", output_format: "wav_44100",
        voice_settings: { stability: 0.3, similarity_boost: 0.75, speed: 1.1, style: 0, use_speaker_boost: true },
        apply_text_normalization: "auto", seed: 42,
        pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "dict1", version_id: "v2" }, { pronunciation_dictionary_id: "dict2" }],
      },
    });
    expect(sleep).toHaveBeenCalledWith(4000);
    expect(root.querySelector(".take audio").getAttribute("src")).toBe("https://s3.example/play.wav");
    expect([...root.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")).toContain("Take ready");
    byText(root, ".take button", "Set live").click();
    await flush();
    expect(root.querySelector(".take.is-live .pill-live").textContent).toBe("Live");
  });

  it("Spots tab adds a spot inline with an auto slug and next position", async () => {
    const posts = [];
    let spots = [{ id: "spt_AbCdEfGhIjKl", place_id: PLACE.id, title: "Gate", slug: "gate", position: 3, in_skim: true, in_detailed: true, is_deleted: false, stats: {} }];
    const { api } = client({
      ...common,
      "GET /dev/v1/admin/spots": () => json(200, { items: spots, total: spots.length }),
      [`POST /dev/v1/admin/places/${PLACE.id}/spots`]: (_u, init) => { const b = JSON.parse(init.body); posts.push(b); spots = [...spots, { ...b, id: "spt_NewNewNewNew", stats: {} }]; return json(201, { ...b, id: "spt_NewNewNewNew" }); },
    });
    window.location.hash = `#/places/${PLACE.id}/spots`;
    tools = mountAdminTools(root, { api });
    await flush();
    const title = root.querySelector('input[aria-label="New spot title"]');
    title.value = "Vittala Temple";
    title.dispatchEvent(new Event("input"));
    expect(root.querySelector('input[aria-label="New spot slug"]').value).toBe("vittala-temple");
    root.querySelector("form.inline-add").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(posts).toEqual([{ slug: "vittala-temple", title: "Vittala Temple", position: 4, in_skim: true, in_detailed: true }]);
    expect(root.querySelector("tbody").textContent).toContain("Vittala Temple");
  });

  it("collection Places tab adds a place from the search picker", async () => {
    const COL = { id: "col_AbCdEfGhIjKl", state_id: PLACE.state_id, slug: "heritage", name: "Heritage", summary: null, cover: null, published: true, is_deleted: false };
    let members = [];
    const puts = [];
    const { api } = client({
      ...common,
      [`GET /dev/v1/admin/collections/${COL.id}`]: () => json(200, COL),
      "GET /dev/v1/admin/collections": () => json(200, { items: [{ ...COL, stats: { image_count: 0, place_count: 0 } }] }),
      [`GET /dev/v1/admin/collections/${COL.id}/places`]: () => json(200, { items: members }),
      [`PUT /dev/v1/admin/collections/${COL.id}/places/${PLACE.id}`]: (_u, init) => { puts.push(JSON.parse(init.body)); members = [{ place_id: PLACE.id, name: "Hampi", slug: "hampi", position: 0, published: false }]; return json(200, {}); },
    });
    window.location.hash = `#/collections/${COL.id}/places`;
    tools = mountAdminTools(root, { api });
    await flush();
    expect([...root.querySelectorAll(".tabs .tab")].map((t) => t.textContent)).toEqual(["Details", "Media", "Places"]);
    const search = root.querySelector('input[aria-label="Search places to add"]');
    search.value = "ham";
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flush();
    byText(root, ".picker-results button", "Add").click();
    await flush();
    expect(puts).toEqual([{ position: 0 }]);
    expect(root.querySelector("tbody").textContent).toContain("Hampi");
  });

  it("quick create makes a place and opens its Media tab", async () => {
    const posts = [];
    const { api } = client({
      ...common,
      "POST /dev/v1/admin/places": (_u, init) => { posts.push(JSON.parse(init.body)); return json(201, { ...PLACE, id: "plc_NewNewNewNewN" }); },
      "GET /dev/v1/admin/places/plc_NewNewNewNewN": () => json(200, { ...PLACE, id: "plc_NewNewNewNewN" }),
      "GET /dev/v1/admin/images": () => json(200, { items: [] }),
    });
    tools = mountAdminTools(root, { api });
    await flush();
    root.querySelector(".crm-new").click();
    root.querySelector('.crm-new-menu button[data-kind="place"]').click();
    await flush();
    const modal = root.querySelector(".modal");
    expect(modal.getAttribute("aria-label")).toBe("New place");
    modal.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(modal.textContent).toContain("Required");
    expect(posts).toHaveLength(0);
    const [name, slug] = modal.querySelectorAll('input[type="text"]');
    name.value = "Badami Caves";
    name.dispatchEvent(new Event("input"));
    expect(slug.value).toBe("badami-caves");
    modal.querySelector("select").value = PLACE.state_id;
    modal.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(posts).toEqual([{ state_id: PLACE.state_id, slug: "badami-caves", name: "Badami Caves", published: false }]);
    expect(root.querySelector(".modal")).toBeNull();
    expect(window.location.hash).toBe("#/places/plc_NewNewNewNewN/media");
  });

  it("Voices: list with language badges, and a mapping save on the voice page", async () => {
    const VOICE = { id: "vce_zYGnkRGptHgi", slug: "padma", display_name: "Padma", gender: "female", description: null, sort_order: 0, is_active: true, is_deleted: false,
      languages: [{ language: "kan", provider_voice_id: "pv1", is_default: true, is_deleted: false, preview_url: null }] };
    const puts = [];
    const { api } = client({
      ...common,
      "GET /dev/v1/admin/voices": () => json(200, { items: [VOICE], total: 1 }),
      [`GET /dev/v1/admin/voices/${VOICE.id}`]: () => json(200, VOICE),
      [`PUT /dev/v1/admin/voices/${VOICE.id}/languages/eng`]: (_u, init) => { puts.push(JSON.parse(init.body)); return json(200, {}); },
    });
    window.location.hash = "#/voices";
    tools = mountAdminTools(root, { api });
    await flush();
    expect(root.querySelector("tbody").textContent).toContain("Padma");
    expect(root.querySelector("tbody .badge").textContent).toBe("kan ★");
    root.querySelector("tbody tr").click();
    await flush();
    expect(root.querySelector(".record-head h2").textContent).toBe("Padma");
    const add = root.querySelector("form.inline-add");
    add.querySelector('select[aria-label="Language"]').value = "eng";
    add.querySelector('input[aria-label="ElevenLabs voice id"]').value = "pv-eng";
    add.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(puts).toEqual([{ provider_voice_id: "pv-eng", is_default: false }]);
  });
});
