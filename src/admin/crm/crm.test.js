// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { parseHash, formatHash } from "./route.js";
import { rowBadges, scriptBadges, completenessScore } from "./completeness.js";
import { listQuery, initialListState, coverThumb } from "./lists.js";
import { buildGenerateBody, defaultTtsForm, formFromTake, parseDictionaries, hasActiveTakes, groupTakes } from "./audio.js";
import { partitionFiles, MEDIA_TYPES } from "./media.js";
import { slugify, createToaster } from "./dom.js";
import { textStats } from "./scriptsTab.js";
import { voicePatch } from "./voices.js";
import { voiceCreatePayload } from "./quickCreate.js";
import { xhrPut } from "../upload.js";

const OPTIONS = { default_model_id: "eleven_multilingual_v2", default_output_format: "mp3_44100_128",
  voice_settings: { stability: { default: 0.5 }, similarity_boost: { default: 0.75 }, style: { default: 0 }, speed: { default: 1 }, use_speaker_boost: { default: true } } };

describe("routes", () => {
  it("parses sections, ids and tabs with safe fallbacks", () => {
    expect(parseHash("")).toEqual({ section: "places", kind: "place", id: null, tab: null });
    expect(parseHash("#/spots")).toMatchObject({ section: "spots", id: null });
    expect(parseHash("#/places/plc_AbCdEfGhIjKl/audio")).toEqual({ section: "places", kind: "place", id: "plc_AbCdEfGhIjKl", tab: "audio" });
    expect(parseHash("#/places/plc_AbCdEfGhIjKl/places").tab).toBe("details");
    expect(parseHash("#/collections/col_AbCdEfGhIjKl/places").tab).toBe("places");
    expect(parseHash("#/places/<script>").id).toBeNull();
    expect(parseHash("#/nope/x")).toMatchObject({ section: "places", id: null });
  });
  it("formats hashes and drops the default tab", () => {
    expect(formatHash({ section: "voices" })).toBe("#/voices");
    expect(formatHash({ section: "places", id: "plc_AbCdEfGhIjKl", tab: "details" })).toBe("#/places/plc_AbCdEfGhIjKl");
    expect(formatHash({ section: "spots", id: "spt_AbCdEfGhIjKl", tab: "media" })).toBe("#/spots/spt_AbCdEfGhIjKl/media");
  });
});

describe("completeness", () => {
  it("marks skim/detailed per language", () => {
    const b = scriptBadges({ eng: ["skim"], kan: ["skim", "detailed"] }, [{ code: "kan" }, { code: "eng" }, { code: "hin" }]);
    expect(b.map((x) => [x.label, x.ok, x.partial])).toEqual([["kan SD", true, false], ["eng S–", false, true], ["hin ––", false, false]]);
  });
  it("builds row badges per kind and a score", () => {
    const place = rowBadges("place", { cover: "img_x", stats: { image_count: 1, spot_count: 0, scripts: {}, audio_live_count: 0 } }, []);
    expect(place.map((b) => b.key)).toEqual(["cover", "images", "spots", "audio"]);
    expect(completenessScore(place)).toBe(50);
    const col = rowBadges("collection", { stats: { place_count: 3 } });
    expect(col.map((b) => b.label)).toEqual(["Cover", "0 img", "3 places"]);
    expect(completenessScore([])).toBe(0);
  });
});

describe("list query", () => {
  it("sends only set filters and a non-default sort", () => {
    const st = initialListState("places");
    expect(listQuery("places", st)).toEqual({ limit: 25, offset: 0, q: undefined, sort: undefined, include_deleted: undefined });
    st.filters = { has_audio: "true", published: "", state_id: "ste_AbCdEfGhIjKl" };
    st.sort = "name";
    st.deleted = true;
    expect(listQuery("places", st)).toMatchObject({ has_audio: "true", state_id: "ste_AbCdEfGhIjKl", sort: "name", include_deleted: "true" });
    expect(listQuery("places", st).published).toBeUndefined();
  });
  it("builds cover thumbnails from the CDN", () => {
    expect(coverThumb("https://cdn.example/", "img_AbCdEfGhIjKl")).toBe("https://cdn.example/images/img_AbCdEfGhIjKl/150.webp");
    expect(coverThumb("", "img_x")).toBeNull();
    expect(coverThumb("https://cdn", null)).toBeNull();
  });
});

describe("audio generate body", () => {
  const target = { kind: "spot", id: "spt_AbCdEfGhIjKl" };
  it("defaults come from tts/options", () => {
    expect(defaultTtsForm(OPTIONS, { language: "kan" })).toMatchObject({ language: "kan", format: "detailed", model_id: "eleven_multilingual_v2", output_format: "mp3_44100_128", stability: 0.5, speed: 1, enable_logging: true });
  });
  it("includes every option and drops style/speaker boost when the model cannot use them", () => {
    const form = { ...defaultTtsForm(OPTIONS, { language: "kan", format: "skim" }), voice_id: "vce_zYGnkRGptHgi", model_id: "eleven_flash_v2_5", language_code: "kn", seed: "7",
      apply_text_normalization: "on", apply_language_text_normalization: true, use_pvc_as_ivc: true, enable_logging: false, dictionaries: "d1" };
    const out = buildGenerateBody(target, form, { model: { can_use_style: false, can_use_speaker_boost: false }, regenerate: true });
    expect(out.ok).toBe(true);
    expect(out.body).toEqual({
      spot_id: target.id, language: "kan", format: "skim", voice_id: "vce_zYGnkRGptHgi", regenerate: true,
      settings: { model_id: "eleven_flash_v2_5", output_format: "mp3_44100_128", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
        apply_text_normalization: "on", apply_language_text_normalization: true, use_pvc_as_ivc: true, enable_logging: false, language_code: "kn", seed: 7,
        pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "d1" }] },
    });
  });
  it("reports field errors", () => {
    const out = buildGenerateBody(target, { ...defaultTtsForm(OPTIONS), language: "", language_code: "kan", seed: "-1", dictionaries: "a\nb\nc\nd" });
    expect(out.ok).toBe(false);
    expect(Object.keys(out.errors).sort()).toEqual(["dictionaries", "language", "language_code", "seed"]);
  });
  it("parses dictionaries and restores a form from a take", () => {
    expect(parseDictionaries("a:1, b")).toEqual({ value: [{ pronunciation_dictionary_id: "a", version_id: "1" }, { pronunciation_dictionary_id: "b" }] });
    expect(parseDictionaries("a:").error).toMatch(/Bad dictionary/);
    const f = formFromTake({ language: "kan", script_format: "skim", voice_id: "vce_x", settings: { model_id: "eleven_v3", output_format: "wav_44100", seed: 5, voice_settings: { stability: 0.2, speed: 0.9 }, pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "d", version_id: "v" }] } }, OPTIONS);
    expect(f).toMatchObject({ language: "kan", format: "skim", voice_id: "vce_x", model_id: "eleven_v3", output_format: "wav_44100", stability: 0.2, speed: 0.9, similarity_boost: 0.75, seed: 5, dictionaries: "d:v" });
  });
  it("detects active takes and groups them", () => {
    expect(hasActiveTakes([{ status: "ready" }, { status: "processing" }])).toBe(true);
    expect(hasActiveTakes([{ status: "pending", is_deleted: true }])).toBe(false);
    expect([...groupTakes([{ language: "kan", script_format: "skim" }, { language: "kan", script_format: "skim" }, { language: "eng", script_format: "detailed" }]).keys()]).toEqual(["kan/skim", "eng/detailed"]);
  });
});

describe("media and helpers", () => {
  it("accepts images only, video is a disabled slot", () => {
    const { ok, rejected } = partitionFiles([new File(["x"], "a.webp", { type: "image/webp" }), new File(["x"], "v.mp4", { type: "video/mp4" })]);
    expect(ok.map((f) => f.name)).toEqual(["a.webp"]);
    expect(rejected[0].file.name).toBe("v.mp4");
    expect(MEDIA_TYPES.find((t) => t.type === "video").enabled).toBe(false);
  });
  it("slugifies titles", () => {
    expect(slugify("  Vijaya Vittala Temple – Hampi!  ")).toBe("vijaya-vittala-temple-hampi");
    expect(slugify("Écoles")).toBe("ecoles");
    expect(slugify("a".repeat(120)).length).toBe(100);
  });
  it("counts words and minutes", () => {
    expect(textStats("")).toBe("0 words · 0 chars");
    expect(textStats("one two three")).toBe("3 words · 13 chars · ~1 min");
  });
  it("toasts auto-hide and errors are alerts", () => {
    const timers = [];
    const t = createToaster(document.body, { setTimer: (fn, ms) => timers.push([fn, ms]) });
    t.ok("Saved");
    t.error({ message: "Nope", code: "x" });
    expect(t.node.querySelector('[role="alert"]').textContent).toContain("Nope");
    expect(timers.map((x) => x[1])).toEqual([5000, 10000]);
    timers.forEach(([fn]) => fn());
    expect(t.node.children).toHaveLength(0);
  });
  it("xhrPut reports progress and status", async () => {
    const sent = {};
    class FakeXhr {
      constructor() { this.upload = {}; this.headers = {}; }
      open(m, u) { sent.method = m; sent.url = u; }
      setRequestHeader(k, v) { this.headers[k] = v; sent.headers = this.headers; }
      send() { this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 }); this.status = 200; this.onload(); }
    }
    const onProgress = vi.fn();
    await expect(xhrPut("https://s3/x", { "Content-Type": "image/png" }, "body", onProgress, FakeXhr)).resolves.toEqual({ ok: true, status: 200 });
    expect(sent).toEqual({ method: "PUT", url: "https://s3/x", headers: { "Content-Type": "image/png" } });
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });
});

describe("voice forms", () => {
  const row = { display_name: "Padma", gender: "female", description: null, sort_order: 0, is_active: true };
  it("patches only changes", () => {
    expect(voicePatch({ display_name: "Padma", gender: "female", description: "", sort_order: "0", is_active: true }, row)).toMatchObject({ ok: true, empty: true });
    expect(voicePatch({ display_name: "Padma R", gender: "female", description: "Warm", sort_order: "2", is_active: false }, row).payload)
      .toEqual({ display_name: "Padma R", description: "Warm", sort_order: 2, is_active: false });
    expect(voicePatch({ display_name: "", gender: "x", description: "", sort_order: "a" }, row).errors).toEqual({ display_name: "Required", gender: "Pick one", sort_order: "Whole number between -10000 and 10000" });
  });
  it("validates quick-create voices", () => {
    expect(voiceCreatePayload({ display_name: " Kanha ", slug: "kanha", gender: "male" })).toEqual({ ok: true, errors: {}, payload: { slug: "kanha", display_name: "Kanha", gender: "male" } });
    expect(voiceCreatePayload({ display_name: "", slug: "Bad Slug", gender: "" }).errors).toEqual({ display_name: "Required", slug: "Lower-case words joined by -, max 60", gender: "Pick one" });
  });
});
