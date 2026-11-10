/** Completeness badges for CRM list rows and record headers (store-listing 001 increment 4). */

/** `scripts` is `{ eng: ["detailed", "skim"] }` from the bk-content list stats. */
export function scriptBadges(scripts, languages = []) {
  const codes = languages.length ? languages.map((l) => l.code) : Object.keys(scripts ?? {});
  return codes.map((code) => {
    const have = new Set(scripts?.[code] ?? []);
    const s = have.has("skim");
    const d = have.has("detailed");
    return {
      key: `scripts-${code}`,
      label: `${code} ${s ? "S" : "–"}${d ? "D" : "–"}`,
      ok: s && d,
      partial: (s || d) && !(s && d),
      title: `${code}: skim ${s ? "yes" : "missing"}, detailed ${d ? "yes" : "missing"}`,
    };
  });
}

/** Badges for one list row of `kind` (place | spot | collection). */
export function rowBadges(kind, row, languages = []) {
  const st = row?.stats ?? {};
  const out = [
    { key: "cover", label: "Cover", ok: Boolean(row?.cover), title: row?.cover ? "Cover set" : "No cover image" },
    { key: "images", label: `${st.image_count ?? 0} img`, ok: (st.image_count ?? 0) > 0, title: "Images" },
  ];
  if (kind === "place") out.push({ key: "spots", label: `${st.spot_count ?? 0} spots`, ok: (st.spot_count ?? 0) > 0, title: "Spots" });
  if (kind === "collection") {
    out.push({ key: "places", label: `${st.place_count ?? 0} places`, ok: (st.place_count ?? 0) > 0, title: "Places in collection" });
    return out;
  }
  out.push(...scriptBadges(st.scripts, languages));
  out.push({ key: "audio", label: `${st.audio_live_count ?? 0} live audio`, ok: (st.audio_live_count ?? 0) > 0,
    title: `${st.audio_ready_count ?? 0} ready takes, ${st.audio_live_count ?? 0} live` });
  return out;
}

/** 0..100: share of badges that are complete. */
export function completenessScore(badges) {
  if (!badges.length) return 0;
  return Math.round((badges.filter((b) => b.ok).length / badges.length) * 100);
}
