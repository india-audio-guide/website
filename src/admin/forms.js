/** Form fields and payload mapping for the catalogue admin screens.
 * Mirrors the zod schemas in bk-content src/routes/admin.js (strict objects:
 * only these keys are ever sent). `cover` is never a form field; it is set
 * from the gallery (img_ id of this parent) or cleared with null.
 */

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const STATE_ID_RE = /^ste_[A-Za-z0-9_-]{12}$/;

const slug = { name: "slug", label: "Slug", type: "text", required: true, max: 100, pattern: SLUG_RE, patternHint: "Lower-case words joined by -" };
const summary = { name: "summary", label: "Summary", type: "textarea", max: 5000, nullable: true };
const catalogueSummary = { name: "summary", label: "Catalogue summary", type: "textarea", max: 5000, nullable: true };
const latitude = { name: "latitude", label: "Latitude", type: "float", min: -90, max: 90, nullable: true };
const longitude = { name: "longitude", label: "Longitude", type: "float", min: -180, max: 180, nullable: true };
const stateId = { name: "state_id", label: "State", type: "state", required: true };
const published = { name: "published", label: "Published", type: "bool", createOnly: true };

export const ENTITIES = {
  place: {
    label: "Place",
    plural: "Places",
    parentType: "place",
    path: "/v1/admin/places",
    publish: true,
    titleField: "name",
    fields: [
      stateId,
      slug,
      { name: "name", label: "Name", type: "text", required: true, min: 1, max: 200 },
      { name: "city", label: "City", type: "text", max: 200, nullable: true },
      catalogueSummary,
      latitude,
      longitude,
      { name: "skim_minutes", label: "Skim minutes", type: "int", min: 1, nullable: true },
      { name: "detailed_minutes", label: "Detailed minutes", type: "int", min: 1, nullable: true },
      published,
    ],
  },
  spot: {
    label: "Spot",
    plural: "Spots",
    parentType: "spot",
    path: "/v1/admin/spots",
    publish: false,
    titleField: "title",
    fields: [
      slug,
      { name: "title", label: "Title", type: "text", required: true, min: 1, max: 200 },
      catalogueSummary,
      latitude,
      longitude,
      { name: "radius_m", label: "Radius (m)", type: "int", min: 1, nullable: true },
      { name: "position", label: "Position", type: "int", min: 0, required: true },
      { name: "in_skim", label: "In skim tour", type: "bool", required: true },
      { name: "in_detailed", label: "In detailed tour", type: "bool", required: true },
    ],
  },
  collection: {
    label: "Collection",
    plural: "Collections",
    parentType: "collection",
    path: "/v1/admin/collections",
    publish: true,
    titleField: "name",
    fields: [
      stateId,
      slug,
      { name: "name", label: "Name", type: "text", required: true, min: 1, max: 200 },
      summary,
      published,
    ],
  },
};

const isEmpty = (raw) => raw === undefined || raw === null || String(raw).trim() === "";

/**
 * Parses one raw form value. Returns `{ value }` (undefined = empty) or `{ error }`.
 * Booleans come in as booleans; everything else as strings.
 */
export function parseField(field, raw) {
  if (field.type === "bool") return { value: Boolean(raw) };
  if (isEmpty(raw)) return field.required ? { error: "Required" } : { value: undefined };
  const text = String(raw).trim();
  switch (field.type) {
    case "float": {
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: "Must be a number" };
      if (n < field.min || n > field.max) return { error: `Must be between ${field.min} and ${field.max}` };
      return { value: n };
    }
    case "int": {
      if (!/^-?\d+$/.test(text)) return { error: "Must be a whole number" };
      const n = Number(text);
      if (field.min !== undefined && n < field.min) return { error: `Must be at least ${field.min}` };
      return { value: n };
    }
    case "state":
      return STATE_ID_RE.test(text) ? { value: text } : { error: "Pick a state" };
    default: {
      if (field.max !== undefined && text.length > field.max) return { error: `At most ${field.max} characters` };
      if (field.pattern && !field.pattern.test(text)) return { error: field.patternHint || "Invalid format" };
      return { value: text };
    }
  }
}

/** Raw form values (strings / booleans) from an API row, for filling an edit form. */
export function rowToValues(entity, row) {
  const values = {};
  for (const field of ENTITIES[entity].fields) {
    const v = row?.[field.name];
    values[field.name] = field.type === "bool" ? Boolean(v) : v === null || v === undefined ? "" : String(v);
  }
  return values;
}

function fieldsFor(entity, mode) {
  return ENTITIES[entity].fields.filter((f) => !(mode === "patch" && f.createOnly));
}

/** Create body: required fields plus non-empty optional ones. Returns `{ ok, payload, errors }`. */
export function toCreatePayload(entity, values) {
  const payload = {};
  const errors = {};
  for (const field of fieldsFor(entity, "create")) {
    const { value, error } = parseField(field, values?.[field.name]);
    if (error) errors[field.name] = error;
    else if (value !== undefined) payload[field.name] = value;
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, payload: ok ? payload : null, errors };
}

/**
 * PATCH body: only fields that differ from `original` (an API row). A cleared optional field
 * becomes null. Returns `{ ok, payload, errors, empty }`; `empty` means nothing changed.
 */
export function toPatchPayload(entity, values, original) {
  const payload = {};
  const errors = {};
  const before = rowToValues(entity, original);
  for (const field of fieldsFor(entity, "patch")) {
    const raw = values?.[field.name];
    const { value, error } = parseField(field, raw);
    if (error) {
      errors[field.name] = error;
      continue;
    }
    const prev = parseField({ ...field, required: false }, before[field.name]).value;
    const next = value === undefined ? null : value;
    const old = prev === undefined ? null : prev;
    if (next !== old) {
      if (next === null && !field.nullable) {
        errors[field.name] = "Required";
        continue;
      }
      payload[field.name] = next;
    }
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, payload: ok ? payload : null, errors, empty: ok && Object.keys(payload).length === 0 };
}

/** Next position for a new member or spot: max(position) + 1, or 0. */
export function nextPosition(items) {
  const positions = (items ?? []).map((i) => Number(i.position)).filter(Number.isInteger);
  return positions.length ? Math.max(...positions) + 1 : 0;
}

/** Validates a membership position input. */
export function parsePosition(raw) {
  return parseField({ type: "int", min: 0, required: true }, raw);
}
