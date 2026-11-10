/** Narration script helpers for the CRM Scripts tab (docs 019 / store-listing 001; UI in crm/scriptsTab.js). */

const FORMATS = ["skim", "detailed"];

/** Builds `{ place_id }` or `{ spot_id }` for list/upsert query and body. */
export function scriptTargetQuery(kind, id) {
  if (kind === "place") return { place_id: id };
  if (kind === "spot") return { spot_id: id };
  throw new Error(`Scripts are only for place or spot, not ${kind}`);
}

/**
 * Loads languages and existing scripts for one target+language.
 * Returns `{ languages, byFormat: { skim?, detailed? } }` where each format value
 * is `{ id, version, content }` or null when no row.
 */
export async function loadScriptEditors(api, { kind, id, language }) {
  const languages = (await api.get("media", "/v1/admin/script-languages", { limit: 100 }))?.items ?? [];
  const live = languages.filter((l) => !l.is_deleted);
  const target = scriptTargetQuery(kind, id);
  const list = language
    ? (await api.get("media", "/v1/admin/scripts", { ...target, language, limit: 10 }))?.items ?? []
    : [];
  const byFormat = { skim: null, detailed: null };
  for (const format of FORMATS) {
    const row = list.find((s) => s.format === format && !s.is_deleted);
    if (!row) continue;
    const full = await api.get("media", `/v1/admin/scripts/${encodeURIComponent(row.id)}`);
    byFormat[format] = { id: full.id, version: full.version, content: full.content ?? "" };
  }
  return { languages: live, byFormat };
}

/** PUT upsert; returns `{ script, changed }`. */
export function saveScript(api, { kind, id, language, format, content }) {
  return api.put("media", "/v1/admin/scripts", {
    ...scriptTargetQuery(kind, id),
    language,
    format,
    content,
  });
}
