/** Hash routes for the CRM admin: #/places, #/places/{id}/{tab}, #/spots…, #/collections…, #/voices, #/voices/{id}. */
export const SECTIONS = Object.freeze(["places", "spots", "collections", "voices"]);
export const KIND_OF = Object.freeze({ places: "place", spots: "spot", collections: "collection", voices: "voice" });
export const SECTION_OF = Object.freeze({ place: "places", spot: "spots", collection: "collections", voice: "voices" });
export const TABS = Object.freeze({
  place: ["details", "media", "spots", "scripts", "audio"],
  spot: ["details", "media", "scripts", "audio"],
  collection: ["details", "media", "places"],
  voice: ["details"],
});
const ID_RE = /^(plc|spt|col|vce)_[A-Za-z0-9_-]{12}$/;

/** Parses a location hash. Unknown input falls back to the places list. */
export function parseHash(hash) {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const section = SECTIONS.includes(parts[0]) ? parts[0] : "places";
  const kind = KIND_OF[section];
  const id = parts[1] && (parts[1] === "new" || ID_RE.test(parts[1])) ? parts[1] : null;
  const tab = id && TABS[kind].includes(parts[2]) ? parts[2] : id ? "details" : null;
  return { section, kind, id, tab };
}

export function formatHash({ section, id, tab }) {
  let out = `#/${section}`;
  if (id) out += `/${encodeURIComponent(id)}`;
  if (id && tab && tab !== "details") out += `/${tab}`;
  return out;
}
