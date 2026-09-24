import { describe, expect, it, vi } from "vitest";
import { COMIC_FONT_FAMILY, loadComicFonts, type ComicFontSet } from "./comic-font";

describe("comic font loading", () => {
  it("requests the regular and italic faces before canvas rendering", async () => {
    const load = vi.fn(async (_font: string, _text?: string) => []);
    const loaded = await loadComicFonts({ load, ready: Promise.resolve() });
    expect(loaded).toBe(true);
    expect(load.mock.calls.map(([font]) => font)).toEqual([
      '400 12px "Comic Neue"',
      'italic 400 12px "Comic Neue"',
    ]);
  });

  it("falls back without preventing rendering when fonts cannot load", async () => {
    const fonts: ComicFontSet = { load: async () => { throw new Error("offline"); }, ready: Promise.resolve() };
    expect(await loadComicFonts(fonts)).toBe(false);
    expect(COMIC_FONT_FAMILY.endsWith("Arial, sans-serif")).toBe(true);
  });
});
