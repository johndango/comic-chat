import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "../v2.5-beta-1-modern/comicart",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
