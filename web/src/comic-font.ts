/** Keep canvas measurement and drawing on the same bundled face everywhere. */
export const COMIC_FONT_FAMILY = '"Comic Neue", "Comic Sans MS", Arial, sans-serif';

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
