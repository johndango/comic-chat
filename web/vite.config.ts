import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "../v2.5-beta-1-modern/comicart",
  server: {
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
