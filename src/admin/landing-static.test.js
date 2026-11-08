import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("landing page stays fully static", () => {
  const source = read("index.html");

  it("has no scripts, Firebase, login controls, or admin links", () => {
    expect(source).not.toMatch(/<script/i);
    expect(source).not.toMatch(/firebase/i);
    expect(source).not.toMatch(/login|sign[\s-]?in|admin/i);
  });

  it("does not mention admin in robots as an allowed path", () => {
    const robots = read("public/robots.txt");
    expect(robots).toMatch(/Disallow: \/admin\/?/);
    const sitemap = read("public/sitemap.xml");
    expect(sitemap).toContain("https://india-audio-guide.github.io/website/");
    expect(sitemap).not.toMatch(/admin/);
  });
});

describe("built marketing bundle (when dist exists)", () => {
  const distIndex = resolve(root, "dist/index.html");
  const skip = !existsSync(distIndex);

  it.skipIf(skip)("does not add scripts or a login link after build", () => {
    const html = readFileSync(distIndex, "utf8");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/firebase/i);
    expect(html).not.toMatch(/login|sign[\s-]?in|\/admin/i);
  });
});
