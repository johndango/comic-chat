// Word balloons, ported from balloon.cpp (CLabel, CBalloon, CBWoodring*).
// Coordinates are twips with y growing upward; see geometry.ts.

import {
  add,
  arcPath,
  BetaSpline,
  boundsOf,
  distance,
  scale,
  sub,
  vectorToAngle,
  type PathCommand,
  type Point,
  type Rect,
} from "./geometry";
import type { MsvcRand } from "./rand";

export type BalloonMode = "say" | "think" | "whisper" | "action";

/** Font measurements in twips, mirroring CFontInfo. */
export interface FontMetrics {
  /** Advance width of `text` in twips. */
  measure(text: string): number;
  /** tmHeight — the text cell height (GetTextExtent().cy). */
  textHeight: number;
  /** tmHeight + leading. */
  lineHeight: number;
  baseAdd: number;
  topOffset: number;
  /** Width of the "..." continuation string. */
  continuationWidth: number;
}

export interface BalloonFonts {
  normal: FontMetrics;
  whisper: FontMetrics;
}

/**
 * Build CFontInfo-equivalent metrics for the balloon font. `measure` must
 * report widths in the same units as `pointSize * 20` (twips).
 * fonts.cpp applies Comic Sans-specific vertical kerning of -40/+30 per 9pt.
 */
export function balloonFontMetrics(
  measure: (text: string) => number,
  options: { pointSize?: number; textHeightEm?: number; comicSans?: boolean } = {},
): FontMetrics {
  const pointSize = options.pointSize ?? 12;
  const em = pointSize * 20;
  const reduction = em / 180;
  const kern = options.comicSans === false ? 0 : 1;
  const leading = Math.trunc(-40 * reduction * kern);
  const baseAdd = Math.trunc(30 * reduction * kern);
  // Comic Sans MS ascent + descent is 1.394 em.
  const textHeight = Math.round(em * (options.textHeightEm ?? 1.394));
  return {
    measure,
    textHeight,
    lineHeight: textHeight + leading,
    baseAdd,
    topOffset: leading ? 0 : 50,
    continuationWidth: measure(CONTINUATION),
  };
}

const MAXLINES = 10;
export const CONTINUATION = "...";

// balloon.cpp constants
const XBOXDELTA = 90;
const YBOXDELTA = 50;
const MINROUTEWIDTH = 300;
const BUBBLEHEIGHT = 150;
const INTERBUBBLE = 100;
const ENDBUBBLEWIDTH = 400;
const VWAVEHEIGHT = 70;
const VWAVEINTERVAL = 300;
const HWAVEHEIGHT = 70;
const HWAVEINTERVAL = 300;
const THRESH1 = -70;
const THRESH2 = 70;
export const XBORDER = 100;
const YBORDER = 40;
export const TOPBORDER = -20;
const LARGEDELTA = 350;
const SMALLDELTA = 150;
const MINTAILHEIGHT = 100;
const BORDERFUDGE = 400;
const LARGEINTEGER = 1_000_000;

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
/** C isprint(); the space character counts as printable. */
const isPrint = (ch: string | undefined): boolean =>
  ch !== undefined && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f;

function nextStart(s: string, i: number): number {
  while (isSpace(s[i])) i += 1;
  return i;
}

function nextEnd(s: string, i: number): number {
  while (i < s.length && isSpace(s[i])) i += 1;
  while (i < s.length && !isSpace(s[i])) i += 1;
  return i;
}

function upcomingReturn(s: string, i: number): boolean {
  while (i < s.length && isSpace(s[i])) {
    if (s[i] === "\n") return true;
    i += 1;
  }
  return false;
}

/** ForceLineBreak: longest prefix of s (from start) that fits, breaking mid-word. */
function forceLineBreak(font: FontMetrics, s: string, start: number, maxWidth: number): { length: number; width: number } {
  let length = 0;
  let width = 0;
  for (;;) {
    length += 1;
    const w = font.measure(s.slice(start, start + length));
    if (start + length < s.length && w <= maxWidth) {
      width = w;
    } else {
      length -= 1;
      if (length < 1) return { length: 1, width: font.measure(s[start]) };
      return { length, width };
    }
  }
}

export interface Line {
  start: number;
  length: number;
  width: number;
}

/** balloon.cpp BreakIntoLines (the US version, which REGISB also used for INTL). */
export function breakIntoLines(font: FontMetrics, maxWidth: number, s: string): Line[] {
  const lines: Line[] = [];
  let lineStart = 0;
  let lineEnd = 0;
  let thisLength = 0;
  let lastLength = 0;
  let lastWidth = 0;
  if (!s.length) return lines;
  for (;;) {
    lineEnd = nextEnd(s, lineEnd);
    lastLength = thisLength;
    thisLength = lineEnd - lineStart;
    const width = font.measure(s.slice(lineStart, lineEnd));
    const foundReturn = upcomingReturn(s, lineEnd);
    if (width <= maxWidth && !foundReturn) {
      if (lineEnd >= s.length) {
        lines.push({ start: lineStart, length: thisLength, width });
        return lines;
      }
      lastWidth = width;
      continue;
    }
    if (lastLength === 0 && width > maxWidth) {
      const forced = forceLineBreak(font, s, lineStart, maxWidth);
      lastLength = forced.length;
      lastWidth = forced.width;
    } else if (foundReturn && width <= maxWidth) {
      lastLength = thisLength;
      lastWidth = width;
    }
    lines.push({ start: lineStart, length: lastLength, width: lastWidth });
    lineStart = lineEnd = nextStart(s, lineStart + lastLength);
    if (lineStart >= s.length) return lines;
    if (lines.length >= MAXLINES) return lines;
    thisLength = 0;
  }
}

/** FindFurthestLineBreak (non-INTL): index just past the last word that fits. */
function findFurthestLineBreak(font: FontMetrics, maxWidth: number, s: string, start: number): number {
  let lineEnd = start;
  for (;;) {
    const lastEnd = lineEnd;
    lineEnd = nextEnd(s, lineEnd);
    if (font.measure(s.slice(start, lineEnd)) <= maxWidth) {
      if (lineEnd >= s.length) return lineEnd;
      continue;
    }
    if (lastEnd === start) return start + forceLineBreak(font, s, start, maxWidth).length;
    return lastEnd;
  }
}

// ---------------------------------------------------------------------------

interface FormatInfo {
  lines: Line[];
  maxWidth: number;
  leftX: number[];
  /** In balloon coordinates (origin at the label's top-left). */
  bbox: Rect;
}

interface Range {
  start: number;
  end: number;
  x: number;
  y: number;
}

function getFilters(f: FormatInfo): { l: Range[]; r: Range[] } {
  const w = f.lines.map((line) => line.width);
  const l: Range[] = [{ start: 0, end: 0, x: f.leftX[0], y: 0 }];
  const r: Range[] = [{ start: 0, end: 0, x: f.leftX[0] + w[0], y: 0 }];
  const n = f.lines.length;
  for (let i = 1; i < n; i += 1) {
    const thisLeft = f.leftX[i];
    const thisRight = f.leftX[i] + w[i];
    const L = l[l.length - 1];
    const R = r[r.length - 1];
    const leftDelta = thisLeft - L.x;
    const rightDelta = thisRight - R.x;
    if (leftDelta <= THRESH1) {
      L.end = i - 1;
      l.push({ start: i, end: i, x: thisLeft, y: 0 });
    } else if (leftDelta <= 0) {
      L.x = thisLeft;
    } else if (leftDelta >= THRESH2) {
      const nextLeft = i + 1 < n ? f.leftX[i + 1] : thisLeft;
      if (nextLeft - L.x >= THRESH2) {
        L.end = i - 1;
        l.push({ start: i, end: i, x: Math.min(thisLeft, nextLeft), y: 0 });
      }
    }
    if (rightDelta >= -THRESH1) {
      R.end = i - 1;
      r.push({ start: i, end: i, x: thisRight, y: 0 });
    } else if (rightDelta >= 0) {
      R.x = thisRight;
    } else if (rightDelta <= -THRESH2) {
      const nextRight = i + 1 < n ? f.leftX[i + 1] + w[i + 1] : thisRight;
      if (nextRight - R.x <= -THRESH2) {
        R.end = i - 1;
        r.push({ start: i, end: i, x: Math.max(thisRight, nextRight), y: 0 });
      }
    }
  }
  l[l.length - 1].end = n - 1;
  r[r.length - 1].end = n - 1;
  return { l, r };
}

function permuteFilters(font: FontMetrics, l: Range[], r: Range[]): number {
  let baseY = 0;
  let lastX = LARGEINTEGER;
  l.forEach((f, i) => {
    f.x -= XBORDER;
    if (i === 0) f.y = baseY + TOPBORDER + YBORDER + font.topOffset;
    else if (f.x < lastX) f.y = baseY + YBORDER;
    else f.y = baseY - YBORDER - font.baseAdd;
    baseY -= (f.end - f.start + 1) * font.lineHeight;
    lastX = f.x;
  });
  baseY = 0;
  lastX = -LARGEINTEGER;
  r.forEach((f, i) => {
    f.x += XBORDER;
    if (i === 0) f.y = baseY + TOPBORDER + YBORDER + font.topOffset;
    else if (f.x > lastX) f.y = baseY + YBORDER;
    else f.y = baseY - YBORDER - font.baseAdd;
    baseY -= (f.end - f.start + 1) * font.lineHeight;
    lastX = f.x;
  });
  return baseY - TOPBORDER - YBORDER - font.baseAdd;
}

function addWavies(p1: Point, p2: Point, pts: Point[], waveDiam: number, interval: number): void {
  const dist = distance(p1, p2);
  const nWaves = dist / interval;
  if (nWaves < 2) return;
  const iWaves = Math.trunc(nWaves);
  const waveLen = dist / iWaves;
  const unit = scale(1 / dist, sub(p2, p1));
  const inc = roundPoint(scale(waveLen, unit));
  const extra = roundPoint(scale(waveDiam, { x: unit.y, y: -unit.x }));
  let base = p1;
  for (let i = 0; i < iWaves - 1; i += 1) {
    base = add(base, inc);
    pts.push(i & 1 ? base : add(base, extra));
  }
}

const roundPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

// ---------------------------------------------------------------------------

export interface ThinkBubble {
  /** Ellipse bounds in panel coordinates. */
  rect: Rect;
}

export interface BalloonGeometry {
  mode: BalloonMode;
  speakerId: string;
  /** The text actually shown (upper-cased; may carry "..." continuations). */
  text: string;
  /** Panel-coordinate outline, including the tail. */
  path: PathCommand[];
  /** Whisper balloons are drawn with a white nimbus and a dashed outline. */
  dashed: boolean;
  thinkBubbles: ThinkBubble[];
  /** Top-left anchor (TextOut TA_TOP) for each line, in panel coordinates. */
  lines: { text: string; x: number; y: number }[];
  lineHeight: number;
  cloudBox: Rect;
}

/** A speaker as the balloon needs to see it. */
export interface BalloonSpeaker {
  id: string;
  arrowX: number;
  bbox: { top: number };
}

/**
 * CBalloon + CBWoodringNormal/Whisper/Think/Box. The instance is mutable during
 * layout exactly like the original (SetBBox, DockAtTop, route regions).
 */
export class Balloon {
  text: string;
  readonly mode: BalloonMode;
  readonly font: FontMetrics;
  readonly leftJustify: boolean;
  speaker: BalloonSpeaker;

  /** m_bbox: origin frame of the label. left/top is the balloon-space origin. */
  box: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  /** m_trueBox: cloud bounds in balloon coordinates. */
  trueBox: Rect = { left: -1, top: -1, right: -1, bottom: -1 };
  routeRgn: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  private format: FormatInfo | null = null;
  private spline: BetaSpline | null = null;

  constructor(text: string, mode: BalloonMode, fonts: BalloonFonts, speaker: BalloonSpeaker) {
    this.mode = mode;
    this.font = mode === "whisper" ? fonts.whisper : fonts.normal;
    this.leftJustify = mode === "action";
    // CBWoodringNormal's constructor capitalises every balloon.
    this.text = text.toLocaleUpperCase();
    this.speaker = speaker;
  }

  get isBox(): boolean {
    return this.mode === "action";
  }

  clone(): Balloon {
    const copy = Object.create(Balloon.prototype) as Balloon;
    Object.assign(copy, this, {
      box: { ...this.box },
      trueBox: { ...this.trueBox },
      routeRgn: { ...this.routeRgn },
    });
    return copy;
  }

  /** CLabel::AreaEstimate */
  areaEstimate(): { area: number; len: number; lineHeight: number } {
    const len = this.font.measure(this.text);
    return {
      area: Math.trunc(1.3 * len * (this.font.textHeight + this.font.lineHeight)),
      len,
      lineHeight: this.font.lineHeight,
    };
  }

  /**
   * CLabel::WidestWord. Because isprint(' ') is true, a "word" is really a
   * whole run of printable characters — normally the entire line. This is
   * what makes Comic Chat prefer wide, shallow balloons.
   */
  widestWord(): number {
    const s = this.text;
    let widest = 0;
    let start = 0;
    for (;;) {
      while (start < s.length && !isPrint(s[start])) start += 1;
      if (start >= s.length) break;
      let end = start;
      while (isPrint(s[end])) end += 1;
      widest = Math.max(widest, this.font.measure(s.slice(start, end)));
      if (end >= s.length) break;
      start = end + 1;
    }
    return widest;
  }

  /** CBWoodringNormal::ComputeInternals for a label of the given width. */
  private computeInternals(labelWidth: number, rng: MsvcRand): boolean {
    const lines = breakIntoLines(this.font, labelWidth, this.text);
    if (!lines.length) return false;
    const maxWidth = Math.max(...lines.map((line) => line.width));
    const left = this.leftJustify ? 0 : Math.trunc((labelWidth - maxWidth) / 2);
    const bbox: Rect = {
      left,
      right: left + maxWidth,
      top: 0,
      bottom: -lines.length * this.font.lineHeight - this.font.baseAdd,
    };
    // ShiftLines: MAXLEFTSHIFT and MAXCENTERSHIFT are 0, but the random draw
    // still happens and advances the generator.
    const leftX = lines.map((line) => {
      rng.randfloat();
      return this.leftJustify ? 0 : Math.trunc((maxWidth - line.width) / 2);
    });
    this.format = { lines, maxWidth, leftX, bbox };

    if (this.isBox) {
      this.spline = null;
      this.trueBox = {
        left: bbox.left - XBOXDELTA,
        right: bbox.right + XBOXDELTA,
        bottom: bbox.bottom - YBOXDELTA,
        top: bbox.top + YBOXDELTA,
      };
    } else {
      this.spline = this.createBalloonSpline(this.format);
      this.trueBox = boundsOf(this.spline.cps);
    }
    return true;
  }

  /** CBWoodringNormal::CreateBalloonSpline — a wavy closed Beta spline hugging the text. */
  private createBalloonSpline(f: FormatInfo): BetaSpline {
    const { l, r } = getFilters(f);
    const finalY = permuteFilters(this.font, l, r);
    let lastY = finalY;
    const pts: Point[] = [];
    l.forEach((filter, i) => {
      const thisPoint = { x: filter.x, y: filter.y };
      if (i > 0) addWavies(pts[pts.length - 1], thisPoint, pts, HWAVEHEIGHT, HWAVEINTERVAL);
      pts.push(thisPoint);
      const nextPoint = { x: filter.x, y: i === l.length - 1 ? finalY : l[i + 1].y };
      addWavies(pts[pts.length - 1], nextPoint, pts, VWAVEHEIGHT, VWAVEINTERVAL);
      pts.push(nextPoint);
    });
    for (let i = r.length - 1; i >= 0; i -= 1) {
      const thisPoint = { x: r[i].x, y: lastY };
      addWavies(pts[pts.length - 1], thisPoint, pts, HWAVEHEIGHT, HWAVEINTERVAL);
      pts.push(thisPoint);
      lastY = r[i].y;
      const nextPoint = { x: r[i].x, y: lastY };
      addWavies(pts[pts.length - 1], nextPoint, pts, VWAVEHEIGHT, VWAVEINTERVAL);
      pts.push(nextPoint);
    }
    addWavies(pts[pts.length - 1], pts[0], pts, HWAVEHEIGHT, HWAVEINTERVAL);
    return new BetaSpline(pts, true);
  }

  /**
   * CBalloon::SetBBox. The original only recomputes internals when the size
   * changes, but LayoutBalloon passes an uninitialised bottom so in practice
   * it always recomputes; we do the same.
   */
  setBBox(left: number, top: number, right: number, rng: MsvcRand): boolean {
    if (!this.computeInternals(right - left - 2 * XBORDER, rng)) return false;
    const bottom = top + this.trueBox.bottom - this.trueBox.top;
    this.box = {
      left: left - this.trueBox.left,
      right: right - this.trueBox.left,
      top: top - this.trueBox.top,
      bottom: bottom - this.trueBox.top,
    };
    return true;
  }

  /** CBalloon::DockAtTop */
  dockAtTop(height: number): void {
    const oldHeight = this.box.top - this.box.bottom;
    this.box.top = height + TOPBORDER;
    this.box.bottom = this.box.top - oldHeight;
  }

  /** CBalloon::GetCloudBBox */
  cloudBox(): Rect {
    return {
      left: this.trueBox.left + this.box.left,
      right: this.trueBox.right + this.box.left,
      top: this.trueBox.top + this.box.top,
      bottom: this.trueBox.bottom + this.box.top,
    };
  }

  /** CBalloon::QueryRouteRgn (boxes impose no constraint). */
  queryRouteRgn(otherToX: number): { left: number; right: number } {
    if (this.isBox) return { left: -LARGEINTEGER, right: LARGEINTEGER };
    const toX = this.speaker.arrowX;
    if (otherToX > toX) return { left: Math.max(toX, this.routeRgn.left + MINROUTEWIDTH), right: LARGEINTEGER };
    return { left: -LARGEINTEGER, right: Math.min(toX, this.routeRgn.right - MINROUTEWIDTH) };
  }

  /** CBalloon::SetRouteRgn */
  setRouteRgn(otherToX: number, left: number, right: number): void {
    if (this.isBox) return;
    if (otherToX > this.speaker.arrowX) this.routeRgn.right = Math.min(this.routeRgn.right, left);
    else this.routeRgn.left = Math.max(this.routeRgn.left, right);
  }

  /**
   * CBWoodringNormal::SplitHeight — keep as many lines as fit in `height`,
   * end with "...", and return the rest (prefixed with "...") or null.
   */
  splitHeight(height: number, rng: MsvcRand): string | null {
    const f = this.format;
    if (!f) return null;
    const maxLines = Math.max(1, Math.trunc((height - BORDERFUDGE) / this.font.lineHeight));
    if (maxLines >= f.lines.length) return null;
    const lastStart = f.lines[maxLines - 1].start;
    let end = findFurthestLineBreak(
      this.font,
      f.bbox.right - f.bbox.left - this.font.continuationWidth,
      this.text,
      lastStart,
    );
    // Make sure a line holds more than just the continuation characters.
    if (end <= CONTINUATION.length && this.text.startsWith(CONTINUATION) && this.text.length > CONTINUATION.length) {
      end = CONTINUATION.length + 1;
    }
    const rest = CONTINUATION + this.text.slice(nextStart(this.text, end));
    this.text = this.text.slice(0, end) + CONTINUATION;
    // Recompute at the same width and top (the "major hack" in the original).
    const cloud = this.cloudBox();
    this.setBBox(cloud.left, cloud.top, this.box.right + this.trueBox.left, rng);
    return rest;
  }

  // -------------------------------------------------------------------------
  // Output

  geometry(): BalloonGeometry {
    const f = this.format;
    if (!f) throw new Error("Balloon has not been laid out");
    const origin = { x: this.box.left, y: this.box.top };
    const toPanel = (p: Point): Point => ({ x: p.x + origin.x, y: p.y + origin.y });
    const lines = f.lines.map((line, i) => ({
      text: this.text.slice(line.start, line.start + line.length),
      x: origin.x + f.leftX[i],
      y: origin.y - i * this.font.lineHeight,
    }));
    let path: PathCommand[];
    let thinkBubbles: ThinkBubble[] = [];

    if (this.isBox) {
      const b = f.bbox;
      const p1 = toPanel({ x: b.left - XBOXDELTA, y: b.bottom - YBOXDELTA });
      const p2 = toPanel({ x: b.left - XBOXDELTA, y: b.top + YBOXDELTA });
      const p3 = toPanel({ x: b.right + XBOXDELTA, y: b.top + YBOXDELTA });
      const p4 = toPanel({ x: b.right + XBOXDELTA, y: b.bottom - YBOXDELTA });
      path = [
        { op: "move", to: p1 },
        { op: "line", to: p2 },
        { op: "line", to: p3 },
        { op: "line", to: p4 },
        { op: "close" },
      ];
    } else if (this.mode === "think") {
      const spline = this.spline!;
      path = [{ op: "move", to: toPanel(spline.bezpts[0]) }, ...translate(spline.toPath(), origin), { op: "close" }];
      thinkBubbles = this.thinkBubbles(f);
    } else {
      path = this.pathWithArrow(f, origin);
    }

    return {
      mode: this.mode,
      speakerId: this.speaker.id,
      text: this.text,
      path,
      dashed: this.mode === "whisper",
      thinkBubbles,
      lines,
      lineHeight: this.font.lineHeight,
      cloudBox: this.cloudBox(),
    };
  }

  /** CBWoodringNormal::AddArrow + BreakSpline: open the cloud and draw the tail. */
  private pathWithArrow(f: FormatInfo, origin: Point): PathCommand[] {
    const route = this.routeRgn;
    const bottom2 = { x: this.speaker.arrowX, y: this.speaker.bbox.top + 200 };
    const cbbox = this.cloudBox();
    let xbreak = Math.trunc((route.left + route.right) / 2) - origin.x;
    const last = f.lines.length - 1;
    const bottomStart = f.leftX[last];
    const bottomEnd = bottomStart + f.lines[last].width;
    if (xbreak < bottomStart && bottomStart + origin.x < route.right - LARGEDELTA) xbreak = bottomStart + SMALLDELTA;
    else if (xbreak > bottomEnd && bottomEnd + origin.x > route.left + LARGEDELTA) xbreak = bottomEnd - SMALLDELTA;

    const top2 = { x: xbreak + origin.x, y: cbbox.bottom };
    if (top2.y - bottom2.y < MINTAILHEIGHT) bottom2.y = top2.y - MINTAILHEIGHT;
    const bottom = { x: bottom2.x - origin.x, y: bottom2.y - origin.y };

    // Limit the tail to 45 degrees. The original only catches tails leaning
    // left (|angle| > 3PI/4); tails leaning far right are not clamped.
    let ang = vectorToAngle(sub(top2, bottom2));
    if (Math.abs(ang) - Math.PI / 2 > Math.PI / 4) {
      ang = ang > (3 * Math.PI) / 4 ? (3 * Math.PI) / 4 : Math.PI / 4;
      xbreak = Math.trunc(Math.cos(ang) * (top2.y - bottom2.y) + bottom2.x - origin.x);
    }

    const spline = breakSpline(this.spline!, xbreak, f.bbox.bottom);
    const left = spline.cps[spline.cps.length - 1];
    const right = spline.cps[0];
    const gapMid = { x: (left.x + right.x) / 2 + origin.x, y: (left.y + right.y) / 2 + origin.y };
    const alt = Math.trunc(0.05 * Math.trunc(distance(gapMid, bottom2)));
    const sign = bottom.x > left.x ? 1 : -1;

    const local: PathCommand[] = [
      { op: "move", to: spline.bezpts[0] },
      ...spline.toPath(),
      { op: "line", to: left },
      ...arcPath(left, bottom, sign * alt),
      ...arcPath(bottom, right, -sign * alt),
      { op: "close" },
    ];
    return translate(local, origin);
  }

  /** CBWoodringThink::Draw — a trail of widening bubbles toward the speaker. */
  private thinkBubbles(f: FormatInfo): ThinkBubble[] {
    const entry = { x: Math.trunc((this.routeRgn.left + this.routeRgn.right) / 2), y: f.bbox.bottom + this.box.top };
    const tail = { x: this.speaker.arrowX, y: this.speaker.bbox.top + 200 };
    const deltaY = entry.y - tail.y;
    if (deltaY < 0) return [];
    const n = Math.trunc((deltaY + INTERBUBBLE) / (BUBBLEHEIGHT + INTERBUBBLE));
    if (n <= 0) return [];
    const spacing = n > 1 ? Math.trunc((deltaY - BUBBLEHEIGHT * n) / (n - 1)) : 0;
    const delta = sub(entry, tail);
    const len = Math.hypot(delta.x, delta.y) || 1;
    const unit = scale(1 / len, delta);
    let center = add(tail, roundPoint(scale(BUBBLEHEIGHT / 2, unit)));
    const increment = roundPoint(scale(BUBBLEHEIGHT + spacing, unit));
    const widthDelta = n > 1 ? Math.trunc((ENDBUBBLEWIDTH - BUBBLEHEIGHT) / (2 * (n - 1))) : 0;
    const out: ThinkBubble[] = [];
    let widen = 0;
    for (let i = 0; i < n; i += 1) {
      const half = BUBBLEHEIGHT / 2;
      out.push({
        rect: {
          left: center.x - half - widen,
          right: center.x + half + widen,
          top: center.y + half,
          bottom: center.y - half,
        },
      });
      center = add(center, increment);
      widen += widthDelta;
    }
    return out;
  }
}

function translate(path: PathCommand[], o: Point): PathCommand[] {
  const t = (p: Point): Point => ({ x: p.x + o.x, y: p.y + o.y });
  return path.map((c) => {
    switch (c.op) {
      case "move":
      case "line":
        return { op: c.op, to: t(c.to) };
      case "bezier":
        return { op: "bezier", c1: t(c.c1), c2: t(c.c2), to: t(c.to) };
      default:
        return c;
    }
  });
}

/** balloon.cpp BreakSpline: open a gap of ~160 twips in the cloud at (x, y). */
function breakSpline(closed: BetaSpline, x: number, y: number): BetaSpline {
  const gap = 80;
  const n = closed.cps.length;
  const leftHit = closed.closestPoint({ x: x - gap, y });
  const rightHit = closed.walkHorizontalDistance(leftHit.knotIndex, leftHit.point.x + 2 * gap);
  const lk = leftHit.knotIndex;
  const rk = rightHit.knotIndex;
  const nNew = n + 2 - (((rk - lk + n) % n) + n) % n;
  const cps: Point[] = [rightHit.point];
  for (let i = 1; i <= n; i += 1) cps.push(closed.cps[(((rk + i - 2 + n) % n) + n) % n]);
  cps.length = Math.max(2, nNew);
  cps[cps.length - 1] = leftHit.point;
  return new BetaSpline(cps, false);
}
