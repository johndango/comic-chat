// The opening title panel: a random title, "STARRING", and one row per
// character with their icon and nickname. Ported from panel.cpp
// (GetRandomTitle, CUnitPanelPage::AddTitle / AddStars / AddStarsAux) and
// fonts.cpp (UpdateTitleFonts).

import { breakIntoLines, type FontMetrics } from "./balloon";
import type { Rect } from "./geometry";
import type { MsvcRand } from "./rand";

/** chat.rc IDS_TITLE1..IDS_TITLE16 (IDS_TITLE17 has no string, so 16 are used). */
export const TITLES = [
  "EVERYONE'S A COMIC",
  "DOGGY DOGGY WAH WAH",
  "YOU SHOULDA BEEN THERE",
  "NO EXIT",
  "WISH YOU WERE HERE",
  "DEEPEST DARKEST DESIRES",
  "JUST US CHUMPS",
  "SIGHTED IN CYBERSPACE",
  "THE GANG'S ALL HERE",
  "BORN TO CHAT",
  "NETWORKED NERDS",
  "VIRTUALLY VACUOUS",
  "IF I ONLY HAD A BRAIN",
  "SLUMBER PARTY",
  "MEET MARKET",
  "MICROSOFT CHAT",
];

/** GetRandomTitle */
export function randomTitle(rng: MsvcRand): string {
  const chosen = Math.min(Math.trunc(rng.randfloat() * TITLES.length), TITLES.length - 1);
  return TITLES[chosen];
}

// panel.cpp
const ICONSIZE = 500;
const ICONSPACE = 100;
const BELOWSTARRING = 300;
const REFERENCE_WIDTH = 4860;
// defines.h (negative LOGFONT heights, i.e. character height in twips)
const TITLE_HEIGHT = 576;
const SHOUT_HEIGHT = 252;

export interface Star {
  id: string;
  nickname: string;
  /** Messages sent so far (CAvatarX::m_nSends). */
  sends: number;
  departed?: boolean;
  self?: boolean;
}

/** AddStarsAux ordering: yourself, then present people by messages sent, then those who left. */
export function orderStars(stars: Star[]): Star[] {
  const self = stars.filter((s) => s.self);
  const others = stars
    .filter((s) => !s.self)
    .sort((a, b) => Number(!!a.departed) - Number(!!b.departed) || b.sends - a.sends);
  return [...self, ...others];
}

export interface TitleFonts {
  /** Advance width of `text` at `heightTwips` character height. */
  measure(text: string, heightTwips: number): number;
  /** Text cell height per twip of character height (Comic Sans MS: 1.394). */
  cellEm?: number;
  comicSans?: boolean;
}

export interface TitleLabel {
  text: string;
  /** Top-left (TA_TOP) anchor in panel twips. */
  x: number;
  y: number;
  heightTwips: number;
  /** Clip width for star names (DT_END_ELLIPSIS). */
  maxWidth?: number;
}

export interface TitleLayout {
  width: number;
  height: number;
  labels: TitleLabel[];
  icons: { id: string; rect: Rect }[];
}

function metrics(fonts: TitleFonts, heightTwips: number, leading: number, baseAdd: number): FontMetrics {
  const textHeight = Math.round(heightTwips * (fonts.cellEm ?? 1.394));
  return {
    measure: (text) => fonts.measure(text, heightTwips),
    textHeight,
    lineHeight: textHeight + leading,
    baseAdd,
    topOffset: leading ? 0 : 50,
    continuationWidth: fonts.measure("...", heightTwips),
  };
}

/**
 * CUnitPanelPage::AddTitle + AddStars. `balloonHeightTwips` is the balloon
 * font size (240 for the default 12 pt), which caps both title fonts.
 */
export function layoutTitlePanel(
  title: string,
  stars: Star[],
  fonts: TitleFonts,
  options: { unitWidth?: number; unitHeight?: number; balloonHeightTwips?: number } = {},
): TitleLayout {
  const W = options.unitWidth ?? REFERENCE_WIDTH;
  const H = options.unitHeight ?? W;
  const balloon = options.balloonHeightTwips ?? 240;
  const reduction = W / REFERENCE_WIDTH;
  const kern = fonts.comicSans === false ? 0 : 1;
  const titleHeight = Math.min(Math.trunc(TITLE_HEIGHT * reduction), Math.trunc(1.2 * balloon));
  const shoutHeight = Math.min(Math.trunc(SHOUT_HEIGHT * reduction), balloon);
  const titleFont = metrics(fonts, titleHeight, Math.trunc(-220 * reduction * kern), Math.trunc(120 * reduction * kern));
  const shoutFont = metrics(fonts, shoutHeight, 0, 0);
  const labels: TitleLabel[] = [];

  // Centred label lines (GetFormatInfoCommon centres each line across the panel).
  const centred = (text: string, font: FontMetrics, top: number, height: number): number => {
    const lines = breakIntoLines(font, W, text);
    lines.forEach((line, i) => {
      labels.push({
        text: text.slice(line.start, line.start + line.length),
        x: Math.trunc((W - line.width) / 2),
        y: top - i * font.lineHeight,
        heightTwips: height,
      });
    });
    return top - lines.length * font.lineHeight - font.baseAdd;
  };

  const titleBottom = centred(title.toLocaleUpperCase(), titleFont, -100, titleHeight);
  const starringBottom = centred("STARRING", shoutFont, titleBottom, shoutHeight);

  // AddStars
  const lineHeight = shoutFont.lineHeight;
  const rowHeight = Math.max(ICONSIZE, lineHeight);
  let topY = starringBottom - Math.trunc((BELOWSTARRING * H) / REFERENCE_WIDTH);
  const maxStars = Math.max(0, Math.trunc((H + topY) / rowHeight));
  topY -= rowHeight;
  const shown = orderStars(stars).slice(0, maxStars);
  const maxWidth = Math.max(0, ...shown.map((s) => shoutFont.measure(s.nickname))) + ICONSIZE + ICONSPACE;
  const iconOffset = Math.max(0, Math.trunc((W - maxWidth) / 2));
  const textOffset = iconOffset + ICONSIZE + ICONSPACE;
  const iconV = Math.trunc((rowHeight - ICONSIZE) / 2);
  const textV = Math.trunc((rowHeight - lineHeight) / 2);
  const icons: TitleLayout["icons"] = [];
  for (const star of shown) {
    // SetBBox(left, bottom, right, top): the row's box runs from topY upward.
    icons.push({ id: star.id, rect: { left: iconOffset, right: iconOffset + ICONSIZE, bottom: topY + iconV, top: topY + ICONSIZE + iconV } });
    labels.push({
      text: star.nickname,
      x: textOffset,
      y: topY + lineHeight + textV,
      heightTwips: shoutHeight,
      maxWidth: W - textOffset,
    });
    topY -= rowHeight;
  }
  return { width: W, height: H, labels, icons };
}
