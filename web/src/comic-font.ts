/** Keep canvas measurement and drawing on the same bundled face everywhere. */
export const COMIC_FONT_FAMILY = '"Comic Neue", "Comic Sans MS", Arial, sans-serif';

export const COMIC_FONT_OPTIONS = [
  { id: "comic-neue", label: "Comic Neue (classic)", family: COMIC_FONT_FAMILY, comicMetrics: true },
  { id: "arial", label: "Arial", family: "Arial, Helvetica, sans-serif", comicMetrics: false },
  { id: "verdana", label: "Verdana", family: "Verdana, Geneva, sans-serif", comicMetrics: false },
  { id: "trebuchet", label: "Trebuchet MS", family: '"Trebuchet MS", Arial, sans-serif', comicMetrics: false },
  { id: "georgia", label: "Georgia", family: 'Georgia, "Times New Roman", serif', comicMetrics: false },
  { id: "courier", label: "Courier New", family: '"Courier New", Courier, monospace', comicMetrics: false },
] as const;

export type ComicFontId = typeof COMIC_FONT_OPTIONS[number]["id"];

export function parseComicFontId(value: unknown): ComicFontId {
  return COMIC_FONT_OPTIONS.some((option) => option.id === value) ? value as ComicFontId : "comic-neue";
}

export function comicFontOption(id: ComicFontId): typeof COMIC_FONT_OPTIONS[number] {
  return COMIC_FONT_OPTIONS.find((option) => option.id === id) ?? COMIC_FONT_OPTIONS[0];
}

export interface ComicFontSet {
  load(font: string, text?: string): PromiseLike<unknown>;
  readonly ready: PromiseLike<unknown>;
}

const SPECIMEN = "EVERYONE'S A COMIC 0123456789";

/**
 * Canvas does not repaint itself after a webfont arrives. Explicitly requesting
 * both faces before measuring prevents mobile browsers from baking a generic
 * cursive fallback into the first panels. Failure is non-fatal: Arial remains
 * as the final, readable fallback.
 */
export async function loadComicFonts(fonts: ComicFontSet | undefined): Promise<boolean> {
  if (!fonts) return false;
  try {
    await Promise.all([
      fonts.load('400 12px "Comic Neue"', SPECIMEN),
      fonts.load('italic 400 12px "Comic Neue"', SPECIMEN),
    ]);
    await fonts.ready;
    return true;
  } catch {
    return false;
  }
}
