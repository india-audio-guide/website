import { describe, expect, it } from "vitest";
import { nextPosition, parseField, parsePosition, rowToValues, toCreatePayload, toPatchPayload } from "./forms.js";

const STATE = "ste_AbCdEfGhIjKl";

describe("place create payload", () => {
  it("maps required and filled fields with real types and omits empty optional ones", () => {
    const r = toCreatePayload("place", { state_id: STATE, slug: "hampi", name: " Hampi ", city: "", summary: "", latitude: "15.335", longitude: "76.46", skim_minutes: "30", detailed_minutes: "", published: false });
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({ state_id: STATE, slug: "hampi", name: "Hampi", latitude: 15.335, longitude: 76.46, skim_minutes: 30, published: false });
    expect(r.payload).not.toHaveProperty("cover");
  });

  it("rejects bad slug, state, coordinates and minutes like the API", () => {
    const r = toCreatePayload("place", { state_id: "KA", slug: "Hampi_1", name: "", latitude: "91", longitude: "abc", skim_minutes: "0", detailed_minutes: "1.5" });
    expect(r.ok).toBe(false);
    expect(r.payload).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(["detailed_minutes", "latitude", "longitude", "name", "skim_minutes", "slug", "state_id"]);
    expect(r.errors.slug).toBe("Lower-case words joined by -");
  });

  it("limits text lengths", () => {
    expect(parseField({ type: "text", max: 3 }, "abcd").error).toBe("At most 3 characters");
    expect(parseField({ type: "text", required: true, max: 100, pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ }, "a".repeat(101)).error).toBe("At most 100 characters");
  });
});

describe("spot and collection payloads", () => {
  it("spot needs position and both booleans", () => {
    const r = toCreatePayload("spot", { slug: "stone-chariot", title: "Stone chariot", position: "2", in_skim: true, in_detailed: false, radius_m: "" });
    expect(r.payload).toEqual({ slug: "stone-chariot", title: "Stone chariot", position: 2, in_skim: true, in_detailed: false });
    expect(toCreatePayload("spot", { slug: "a", title: "A", position: "-1" }).errors.position).toBe("Must be at least 0");
  });

  it("collection create keeps only schema keys", () => {
    const r = toCreatePayload("collection", { state_id: STATE, slug: "karnataka-temples", name: "Temples", summary: "Old", published: true, extra: "x" });
    expect(r.payload).toEqual({ state_id: STATE, slug: "karnataka-temples", name: "Temples", summary: "Old", published: true });
  });
});

describe("patch payload", () => {
  const original = { id: "plc_AbCdEfGhIjKl", state_id: STATE, slug: "hampi", name: "Hampi", city: "Hosapete", summary: null, cover: "img_AbCdEfGhIjKl", latitude: 15.335, longitude: 76.46, skim_minutes: 30, detailed_minutes: null, published: true };

  it("sends only changed fields and null for cleared optional ones", () => {
    const values = { ...rowToValues("place", original), name: "Hampi ruins", city: "", latitude: "15.3350" };
    const r = toPatchPayload("place", values, original);
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({ name: "Hampi ruins", city: null });
  });

  it("reports nothing to change, never sends published or cover", () => {
    const r = toPatchPayload("place", rowToValues("place", original), original);
    expect(r.empty).toBe(true);
    expect(r.payload).toEqual({});
    const r2 = toPatchPayload("place", { ...rowToValues("place", original), published: false }, original);
    expect(r2.empty).toBe(true);
  });

  it("numeric strings from the API compare as numbers", () => {
    const pgRow = { ...original, latitude: "15.335000", skim_minutes: "30" };
    expect(toPatchPayload("place", rowToValues("place", pgRow), pgRow).empty).toBe(true);
  });

  it("required fields cannot be cleared", () => {
    const r = toPatchPayload("place", { ...rowToValues("place", original), slug: "" }, original);
    expect(r.ok).toBe(false);
    expect(r.errors.slug).toBe("Required");
  });
});

describe("positions", () => {
  it("next position is max + 1 or 0", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5);
  });
  it("membership position is an integer >= 0", () => {
    expect(parsePosition("3").value).toBe(3);
    expect(parsePosition("").error).toBe("Required");
    expect(parsePosition("x").error).toBe("Must be a whole number");
  });
});
