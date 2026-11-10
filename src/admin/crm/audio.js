/**
 * Audio tab (store-listing 001 increment 4; docs spec 021): generate narration with every ElevenLabs option,
 * poll take status, play each take, set live, regenerate and delete. Takes are assets(type=audio).
 */
import { h, busy, emptyState, field, fmtBytes, fmtDate } from "./dom.js";

export const POLL_MS = 4000;
const FORMATS = ["skim", "detailed"];
const ACTIVE = new Set(["pending", "processing"]);

/** Default form state from GET /v1/admin/tts/options. */
export function defaultTtsForm(options = {}, { language = "", format = "detailed" } = {}) {
  const vs = options.voice_settings ?? {};
  return {
    language, format, voice_id: "",
    model_id: options.default_model_id ?? "",
    output_format: options.default_output_format ?? "mp3_44100_128",
    stability: vs.stability?.default ?? 0.5,
    similarity_boost: vs.similarity_boost?.default ?? 0.75,
    style: vs.style?.default ?? 0,
    speed: vs.speed?.default ?? 1,
    use_speaker_boost: vs.use_speaker_boost?.default ?? true,
    language_code: "",
    seed: "",
    apply_text_normalization: "auto",
    apply_language_text_normalization: false,
    use_pvc_as_ivc: false,
    enable_logging: true,
    dictionaries: "",
  };
}

/** Form state from a take's stored settings (for "Use these settings"). */
export function formFromTake(take, options) {
  const s = take?.settings ?? {};
  const vs = s.voice_settings ?? {};
  const base = defaultTtsForm(options, { language: take?.language ?? "", format: take?.script_format ?? "detailed" });
  return {
    ...base,
    voice_id: take?.voice_id ?? "",
    model_id: s.model_id ?? take?.model_id ?? base.model_id,
    output_format: s.output_format ?? take?.output_format ?? base.output_format,
    stability: vs.stability ?? base.stability,
    similarity_boost: vs.similarity_boost ?? base.similarity_boost,
    style: vs.style ?? base.style,
    speed: vs.speed ?? base.speed,
    use_speaker_boost: vs.use_speaker_boost ?? base.use_speaker_boost,
    language_code: s.language_code ?? "",
    seed: s.seed ?? "",
    apply_text_normalization: s.apply_text_normalization ?? "auto",
    apply_language_text_normalization: Boolean(s.apply_language_text_normalization),
    use_pvc_as_ivc: Boolean(s.use_pvc_as_ivc),
    enable_logging: s.enable_logging ?? true,
    dictionaries: (s.pronunciation_dictionary_locators ?? [])
      .map((d) => (d.version_id ? `${d.pronunciation_dictionary_id}:${d.version_id}` : d.pronunciation_dictionary_id)).join("\n"),
  };
}

/** Parses "dict_id[:version_id]" lines (max 3). Returns { value } or { error }. */
export function parseDictionaries(text) {
  const lines = String(text ?? "").split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 3) return { error: "At most 3 pronunciation dictionaries" };
  const out = [];
  for (const line of lines) {
    const [id, version] = line.split(":").map((p) => p.trim());
    if (!id || id.length > 100 || (version !== undefined && (!version || version.length > 100))) return { error: `Bad dictionary entry: ${line}` };
    out.push(version ? { pronunciation_dictionary_id: id, version_id: version } : { pronunciation_dictionary_id: id });
  }
  return { value: out };
}

/**
 * POST /v1/audio/generate body from form state. `model` is the picked model entry (capabilities hide
 * style / speaker boost when unsupported). Returns { ok, body, errors }.
 */
export function buildGenerateBody(target, form, { model, regenerate = false } = {}) {
  const errors = {};
  if (!form.language) errors.language = "Pick a language";
  if (!FORMATS.includes(form.format)) errors.format = "Pick skim or detailed";
  const voice_settings = {
    stability: Number(form.stability),
    similarity_boost: Number(form.similarity_boost),
    speed: Number(form.speed),
  };
  if (model?.can_use_style !== false) voice_settings.style = Number(form.style);
  if (model?.can_use_speaker_boost !== false) voice_settings.use_speaker_boost = Boolean(form.use_speaker_boost);
  for (const [k, v] of Object.entries(voice_settings)) if (typeof v === "number" && !Number.isFinite(v)) errors[k] = "Must be a number";
  const settings = {
    model_id: form.model_id || undefined,
    output_format: form.output_format || undefined,
    voice_settings,
    apply_text_normalization: form.apply_text_normalization || undefined,
    apply_language_text_normalization: form.apply_language_text_normalization ? true : undefined,
    use_pvc_as_ivc: form.use_pvc_as_ivc ? true : undefined,
    enable_logging: form.enable_logging === false ? false : undefined,
  };
  const code = String(form.language_code ?? "").trim();
  if (code) {
    if (!/^[a-z]{2}$/.test(code)) errors.language_code = "Two-letter code, e.g. en, hi, kn";
    else settings.language_code = code;
  }
  const seed = String(form.seed ?? "").trim();
  if (seed) {
    if (!/^\d+$/.test(seed) || Number(seed) > 4294967295) errors.seed = "Whole number 0 to 4294967295";
    else settings.seed = Number(seed);
  }
  const dicts = parseDictionaries(form.dictionaries);
  if (dicts.error) errors.dictionaries = dicts.error;
  else if (dicts.value.length) settings.pronunciation_dictionary_locators = dicts.value;
  for (const k of Object.keys(settings)) if (settings[k] === undefined) delete settings[k];
  const ok = Object.keys(errors).length === 0;
  if (!ok) return { ok, body: null, errors };
  const body = { [target.kind === "place" ? "place_id" : "spot_id"]: target.id, language: form.language, format: form.format, settings };
  if (form.voice_id) body.voice_id = form.voice_id;
  if (regenerate) body.regenerate = true;
  return { ok, body, errors };
}

export const hasActiveTakes = (takes) => (takes ?? []).some((t) => ACTIVE.has(t.status) && !t.is_deleted);

/** Groups takes by "language/format", newest first inside each group. */
export function groupTakes(takes) {
  const groups = new Map();
  for (const t of takes ?? []) {
    const key = `${t.language}/${t.script_format}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return groups;
}

const settingsSummary = (t) => {
  const s = t.settings ?? {};
  const vs = s.voice_settings ?? {};
  return [s.model_id ?? t.model_id, s.output_format ?? t.output_format,
    vs.stability != null ? `stab ${vs.stability}` : null, vs.similarity_boost != null ? `sim ${vs.similarity_boost}` : null,
    vs.style != null ? `style ${vs.style}` : null, vs.speed != null ? `speed ${vs.speed}` : null,
    vs.use_speaker_boost != null ? `boost ${vs.use_speaker_boost ? "on" : "off"}` : null,
    s.seed != null ? `seed ${s.seed}` : null, s.language_code ? `lang ${s.language_code}` : null].filter(Boolean).join(" · ");
};

/** ctx: { api, toast, confirmFn, sleep, isCurrent, loadLanguages, loadTtsOptions, audioPreset }. */
export function renderAudio(ctx, target, token) {
  const { api, toast, confirmFn } = ctx;
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const node = h("div", { class: "audio-tab" }, h("p", { class: "meta" }, "Loading audio options…"));
  let options = null;
  let voices = [];
  let languages = [];
  let scripts = [];
  let takes = [];
  let form = null;
  let polling = false;
  const takesHost = h("div", { class: "takes" });
  const filterLang = h("select", { "aria-label": "Filter takes by language" }, h("option", { value: "" }, "All languages"));
  const showDeleted = h("input", { type: "checkbox" });
  const targetQuery = { [target.kind === "place" ? "place_id" : "spot_id"]: target.id };

  const voiceName = (id) => voices.find((v) => v.id === id)?.display_name ?? id ?? "default voice";
  const scriptFor = (lang, fmt) => scripts.find((s) => s.language === lang && s.format === fmt && !s.is_deleted);

  async function loadVoices(language) {
    if (!language) return [];
    const res = await api.get("media", "/v1/admin/voices", { language, is_active: "true", limit: 100 });
    return res?.items ?? [];
  }

  async function loadTakes() {
    const q = { ...targetQuery, limit: 100, language: filterLang.value || undefined, include_deleted: showDeleted.checked ? "true" : undefined };
    takes = (await api.get("media", "/v1/admin/audio", q))?.items ?? [];
  }

  async function loadScripts() {
    scripts = (await api.get("media", "/v1/admin/scripts", { ...targetQuery, limit: 100 }))?.items ?? [];
  }

  function buildForm() {
    const model = () => options.models.find((m) => m.model_id === form.model_id);
    const errs = {};
    const lang = h("select", {}, h("option", { value: "" }, "Pick a language"), languages.map((l) => h("option", { value: l.code }, `${l.name ?? l.code} (${l.code})`)));
    lang.value = form.language;
    const fmt = h("select", {}, FORMATS.map((f) => h("option", { value: f }, f === "skim" ? "Skim" : "Detailed")));
    fmt.value = form.format;
    const voice = h("select", {});
    const scriptNote = h("p", { class: "meta script-note" });
    const fillVoices = async () => {
      voices = await loadVoices(form.language).catch((err) => { toast.error(err); return []; });
      if (!ctx.isCurrent(token)) return;
      const defaults = voices.filter((v) => (v.languages ?? []).some((l) => l.language === form.language && l.is_default && !l.is_deleted));
      voice.replaceChildren(h("option", { value: "" }, defaults[0] ? `Default (${defaults[0].display_name})` : "Default voice for language"),
        ...voices.map((v) => h("option", { value: v.id }, `${v.display_name} · ${v.gender}`)));
      voice.value = voices.some((v) => v.id === form.voice_id) ? form.voice_id : "";
      if (form.language && !voices.length) scriptNote.textContent = "No active voice is mapped to this language yet. Map one under Voices first.";
      paintScriptNote();
    };
    const paintScriptNote = () => {
      if (!form.language) { scriptNote.textContent = "Pick the script to narrate."; return; }
      const s = scriptFor(form.language, form.format);
      if (!s) scriptNote.textContent = `No ${form.format} script in ${form.language} yet. Write it in the Scripts tab first.`;
      else if (voices.length || !form.language) scriptNote.textContent = `Narrates script v${s.version}${s.characters ? ` (${s.characters} characters)` : ""}.`;
    };
    lang.addEventListener("change", () => { form.language = lang.value; form.language_code = ""; codeIn.placeholder = options.language_codes?.[form.language] ?? "auto"; void fillVoices(); });
    fmt.addEventListener("change", () => { form.format = fmt.value; paintScriptNote(); });
    voice.addEventListener("change", () => { form.voice_id = voice.value; });

    const modelSel = h("select", {}, options.models.map((m) => h("option", { value: m.model_id }, m.name ?? m.model_id)));
    modelSel.value = form.model_id;
    const outSel = h("select", {}, ["mp3", "opus", "wav", "pcm", "ulaw", "alaw"].map((g) =>
      h("optgroup", { label: g.toUpperCase() }, options.output_formats.filter((f) => f.startsWith(`${g}_`)).map((f) => h("option", { value: f }, f)))));
    outSel.value = form.output_format;
    outSel.addEventListener("change", () => { form.output_format = outSel.value; });

    const slider = (key, label, hint) => {
      const r = options.voice_settings?.[key] ?? { min: 0, max: 1, step: 0.01 };
      const range = h("input", { type: "range", min: r.min, max: r.max, step: r.step ?? 0.01, value: form[key], "aria-label": label });
      const num = h("input", { type: "number", min: r.min, max: r.max, step: r.step ?? 0.01, value: form[key], class: "num", "aria-label": `${label} value` });
      range.addEventListener("input", () => { form[key] = Number(range.value); num.value = range.value; });
      num.addEventListener("change", () => { form[key] = Number(num.value); range.value = num.value; });
      const f = field(label, range, { hint });
      f.node.querySelector("label").after(num);
      f.node.classList.add("slider-field");
      errs[key] = f;
      return f.node;
    };
    const check = (key, label, hint) => {
      const c = h("input", { type: "checkbox", checked: form[key] });
      c.addEventListener("change", () => { form[key] = c.checked; });
      return h("label", { class: "check", title: hint ?? "" }, c, ` ${label}`, hint ? h("span", { class: "hint" }, ` — ${hint}`) : null);
    };
    const styleField = slider("style", "Style exaggeration", "Amplifies the speaker's style; adds latency. 0 is safest.");
    const boostField = check("use_speaker_boost", "Speaker boost", "closer to the original speaker");
    const syncModel = () => {
      form.model_id = modelSel.value;
      const m = model();
      styleField.hidden = m?.can_use_style === false;
      boostField.hidden = m?.can_use_speaker_boost === false;
    };
    modelSel.addEventListener("change", syncModel);

    const codeIn = h("input", { type: "text", maxlength: "2", value: form.language_code, placeholder: options.language_codes?.[form.language] ?? "auto" });
    codeIn.addEventListener("input", () => { form.language_code = codeIn.value.trim(); });
    const seedIn = h("input", { type: "number", min: "0", max: "4294967295", step: "1", value: form.seed, placeholder: "random" });
    seedIn.addEventListener("input", () => { form.seed = seedIn.value; });
    const normSel = h("select", {}, (options.apply_text_normalization ?? ["auto", "on", "off"]).map((v) => h("option", { value: v }, v)));
    normSel.value = form.apply_text_normalization;
    normSel.addEventListener("change", () => { form.apply_text_normalization = normSel.value; });
    const dictIn = h("textarea", { rows: "2", placeholder: "dictionary_id[:version_id], one per line (max 3)" }, form.dictionaries);
    dictIn.addEventListener("input", () => { form.dictionaries = dictIn.value; });
    errs.language = field("Language", lang, { required: true });
    errs.format = field("Script", fmt, { required: true });
    errs.language_code = field("Language code (ISO 639-1)", codeIn, { hint: "Enforces a language for the model. Leave blank for the language default." });
    errs.seed = field("Seed", seedIn, { hint: "Same seed + settings tries to repeat a take." });
    errs.dictionaries = field("Pronunciation dictionaries", dictIn);

    const genBtn = h("button", { type: "submit", class: "btn" }, "Generate");
    const regenBtn = h("button", { type: "button", class: "btn btn-secondary" }, "Generate new take");
    const resetBtn = h("button", { type: "button", class: "btn-text" }, "Reset to defaults");
    const submit = (regenerate, btn) => {
      for (const f of Object.values(errs)) f.setError?.("");
      const out = buildGenerateBody(target, form, { model: model(), regenerate });
      if (!out.ok) {
        for (const [k, msg] of Object.entries(out.errors)) errs[k]?.setError?.(msg);
        toast.error("Fix the highlighted fields.");
        return;
      }
      void busy(btn, toast, async () => {
        const res = await api.post("media", "/v1/audio/generate", out.body);
        toast.ok(res?.reused && res?.status === "ready" ? "A ready take with these settings already exists." : res?.reused ? "That take is already being generated." : "Audio queued. It usually takes under a minute.");
        await refreshTakes();
      });
    };
    resetBtn.addEventListener("click", () => { form = defaultTtsForm(options, { language: form.language, format: form.format }); paintForm(); });
    regenBtn.addEventListener("click", () => submit(true, regenBtn));
    const formNode = h("form", { class: "panel tts-form", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(false, genBtn); } },
      h("h3", {}, "Generate audio"),
      options.key_configured ? null : h("p", { class: "warn" }, `The ElevenLabs API key is not configured (SSM parameter ${options.key_param ?? "elevenlabs/api-key"} under the environment prefix). Takes will fail until it is set.`),
      h("div", { class: "grid-3" }, errs.language.node, errs.format.node, field("Voice", voice).node),
      scriptNote,
      h("div", { class: "grid-2" }, field("Model", modelSel, { hint: options.models_source === "static" ? "Built-in list (live list needs the API key)." : "Live list from ElevenLabs." }).node,
        field("Output format", outSel, { hint: "codec_samplerate_bitrate. WAV is built from PCM. Higher tiers may need a paid plan." }).node),
      h("fieldset", { class: "voice-settings" }, h("legend", {}, "Voice settings"),
        slider("stability", "Stability", "Lower is more expressive, higher is more consistent."),
        slider("similarity_boost", "Similarity", "How closely to match the original voice."),
        styleField,
        slider("speed", "Speed", "1.0 is normal."),
        boostField),
      h("details", { class: "advanced" }, h("summary", {}, "Advanced options"),
        h("div", { class: "grid-2" }, errs.language_code.node, errs.seed.node,
          field("Text normalization", normSel, { hint: "Spell out numbers, dates and so on." }).node, errs.dictionaries.node),
        check("apply_language_text_normalization", "Language text normalization", "better pronunciation for some languages; slower"),
        check("use_pvc_as_ivc", "Use instant clone for professional voices", "lower latency"),
        check("enable_logging", "Provider logging", "off means zero retention (enterprise only)")),
      h("div", { class: "actions" }, genBtn, regenBtn, resetBtn),
      h("p", { class: "meta" }, "Generate reuses an identical existing take; Generate new take always makes a fresh one."));
    syncModel();
    void fillVoices();
    return formNode;
  }

  let formHost = h("div");
  function paintForm() {
    const next = buildForm();
    formHost.replaceWith(next);
    formHost = next;
  }

  function paintTakes() {
    const groups = groupTakes(takes);
    if (!takes.length) {
      takesHost.replaceChildren(emptyState("No audio yet.", "Generate a take above. Each language and script keeps every version."));
      return;
    }
    takesHost.replaceChildren(...[...groups.entries()].map(([key, list]) => {
      const [language, fmt] = key.split("/");
      const current = scriptFor(language, fmt);
      return h("section", { class: "panel take-group" },
        h("h4", {}, `${language} · ${fmt}`, current ? h("span", { class: "meta" }, ` — script v${current.version}`) : null),
        h("ul", { class: "take-list" }, list.map((t) => {
          const stale = current && t.script_version < current.version;
          const btn = (label, fn, cls = "btn-text") => {
            const b = h("button", { type: "button", class: cls }, label);
            b.addEventListener("click", () => void busy(b, toast, fn));
            return b;
          };
          const actions = h("div", { class: "take-actions" });
          if (t.is_deleted) {
            actions.append(btn("Restore", async () => { await api.post("media", `/v1/admin/audio/${encodeURIComponent(t.id)}/restore`); await refreshTakes(); toast.ok("Take restored."); }));
          } else {
            if (t.status === "ready" && !t.is_live) actions.append(btn("Set live", async () => { await api.post("media", `/v1/admin/audio/${encodeURIComponent(t.id)}/live`); await refreshTakes(); toast.ok("Take is live."); }));
            actions.append(btn("Use these settings", async () => { form = formFromTake(t, options); paintForm(); formHost.scrollIntoView?.({ behavior: "smooth" }); }));
            actions.append(btn("Regenerate", async () => {
              const out = buildGenerateBody(target, formFromTake(t, options), { regenerate: true, model: options.models.find((m) => m.model_id === t.settings?.model_id) });
              if (!out.ok) throw new Error(Object.values(out.errors).join("; "));
              await api.post("media", "/v1/audio/generate", out.body);
              await refreshTakes();
              toast.ok("New take queued.");
            }));
            actions.append(btn("Delete", async () => {
              if (!confirmFn(t.is_live ? "Delete the live take? The app will have no audio for this script and voice until another take is live." : "Delete this take?")) return;
              await api.del("media", `/v1/admin/audio/${encodeURIComponent(t.id)}`);
              await refreshTakes();
              toast.ok("Take deleted.");
            }, "btn-text danger"));
          }
          const player = t.status === "ready" && t.play_url ? h("audio", { controls: true, preload: "none", src: t.play_url }) : null;
          return h("li", { class: `take${t.is_live ? " is-live" : ""}${t.is_deleted ? " row-deleted" : ""}`, "data-id": t.id },
            h("div", { class: "take-head" },
              h("span", { class: `pill pill-${t.status}` }, t.status === "processing" ? "Generating…" : t.status),
              t.is_live ? h("span", { class: "pill pill-live" }, "Live") : null,
              stale ? h("span", { class: "pill pill-draft", title: "Made from an older script version" }, `script v${t.script_version} (old)`) : h("span", { class: "meta" }, `script v${t.script_version}`),
              h("span", {}, voiceName(t.voice_id)),
              h("span", { class: "meta" }, [t.duration_seconds ? `${t.duration_seconds}s` : null, fmtBytes(t.bytes), fmtDate(t.created_at)].filter(Boolean).join(" · "))),
            h("p", { class: "meta take-settings" }, settingsSummary(t)),
            t.status === "failed" && t.error ? h("p", { class: "error-inline" }, t.error) : null,
            player, actions);
        })));
    }));
  }

  async function refreshTakes() {
    try {
      await Promise.all([loadTakes(), loadScripts()]);
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    paintTakes();
    if (hasActiveTakes(takes)) void poll();
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      while (ctx.isCurrent(token) && hasActiveTakes(takes)) {
        await sleep(POLL_MS);
        if (!ctx.isCurrent(token)) break;
        const before = new Map(takes.map((t) => [t.id, t.status]));
        await loadTakes();
        if (!ctx.isCurrent(token)) break;
        for (const t of takes) {
          const was = before.get(t.id);
          if (was && ACTIVE.has(was) && t.status === "ready") toast.ok(`Take ready (${t.language} ${t.script_format}).`);
          if (was && ACTIVE.has(was) && t.status === "failed") toast.error(`Take failed: ${t.error ?? "unknown error"}`);
        }
        paintTakes();
      }
    } catch (err) {
      if (ctx.isCurrent(token)) toast.error(err);
    } finally {
      polling = false;
    }
  }

  (async () => {
    try {
      [options, languages] = await Promise.all([ctx.loadTtsOptions(), ctx.loadLanguages()]);
      await loadScripts();
    } catch (err) {
      if (!ctx.isCurrent(token)) return;
      node.replaceChildren(h("p", { class: "error-inline" }, "Could not load audio options."));
      toast.error(err);
      return;
    }
    if (!ctx.isCurrent(token)) return;
    const preset = ctx.audioPreset ?? {};
    ctx.audioPreset = null;
    const firstLang = preset.language ?? scripts.find((s) => !s.is_deleted)?.language ?? languages[0]?.code ?? "";
    form = defaultTtsForm(options, { language: firstLang, format: preset.format ?? "detailed" });
    filterLang.append(...languages.map((l) => h("option", { value: l.code }, l.name ?? l.code)));
    filterLang.addEventListener("change", () => void refreshTakes());
    showDeleted.addEventListener("change", () => void refreshTakes());
    node.replaceChildren(formHost,
      h("div", { class: "panel-head" }, h("h3", {}, "Takes"), h("div", { class: "toolbar" }, filterLang, h("label", { class: "check" }, showDeleted, " Show deleted"))),
      takesHost);
    paintForm();
    await refreshTakes();
  })();

  return { node, refresh: refreshTakes };
}
