import { defineConfig } from "vite";

export default defineConfig({
  base: "/website/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
