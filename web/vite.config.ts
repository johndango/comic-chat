import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  publicDir: "../v2.5-beta-1-modern/comicart",
  server: {
    // The web client deliberately reuses original art and UI bitmaps from the
    // repository instead of copying them into web/. Keep local development as
    // faithful as the production build, where Vite inlines these small assets.
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
    proxy: {
      "/irc": {
        target: "ws://127.0.0.1:8787",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
