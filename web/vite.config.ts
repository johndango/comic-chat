import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

// Link previews (Discord, iMessage, Facebook, X) need the share image as a
// full URL, but Vite writes the hashed path it gives the image as "/assets/…".
// Prefix it with the page's canonical origin after Vite has done that.
function absoluteShareImage(): Plugin {
  return {
    name: "absolute-share-image",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        const html = String(file.source);
        const origin = html.match(/<link rel="canonical" href="(https:\/\/[^/"]+)\//)?.[1];
        if (!origin) continue;
        file.source = html.replace(
          /(<meta (?:property="og:image"|name="twitter:image") content=")(\/[^"]+)"/g,
          (_match, start: string, path: string) => `${start}${origin}${path}"`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [absoluteShareImage()],
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
