// Panel composition and page flow, ported from panel.cpp
// (CUnitPanel::LayoutAvatars / LayoutBalloons, CUnitPanelPage::AddLine).
//
// Coordinates are twips, y up: a panel spans x in [0, unitWidth] and
// y in [-unitHeight, 0].

import { Balloon, TOPBORDER, type BalloonFonts, type BalloonGeometry, type BalloonLink, type BalloonMode } from "./balloon";
import type { Rect } from "./geometry";
import { MsvcRand } from "./rand";
import { randomTitle } from "./title";

/** Pixel dimensions of one pose bitmap plus its face anchor (avatar pose `x`). */
export interface PoseSize {
  width: number;
  height: number;
  /** Distance of the face from the bitmap's left edge, unflipped. */
  faceX: number;
}

export interface ComicLine {
  speakerId: string;
  text: string;
  mode?: BalloonMode;
  /** Force this line to begin a fresh panel (the original hidden <Brk> command). */
  breakBefore?: boolean;
  /** Studio override: try this beat in the current panel before falling back to a new one. */
  stayInPanel?: boolean;
  /** Add the character without a balloon (the original hidden <Chr> command). */
  reaction?: boolean;
  /** The pose the speaker strikes for this line (see emotion.ts selectPose). */
  pose: PoseSize;
  /** Opaque value handed back on the laid-out body, e.g. a pose index. */
  poseRef?: unknown;
  /** HTTP(S) links that should be clickable. Private whispers omit these. */
  links?: BalloonLink[];
}

export interface CastHooks {
  /** Who this speaker is currently addressing (m_udi.m_talkTos). */
  talkTos?: (speakerId: string) => string[];
  /** Neutral pose for a listener pulled into the panel because they were addressed. */
  neutralPose?: (id: string) => { pose: PoseSize; poseRef?: unknown } | undefined;
}

export interface PageOptions extends CastHooks {
  fonts: BalloonFonts;
  /** Panel size in twips. The original never goes below 2300. */
  unitWidth?: number;
  unitHeight?: number;
  /** Seed for the page-wide rand() stream. */
  seed?: number;
  /** Draw the 60-twip black border (and keep balloons inside it). */
  border?: boolean;
}

export interface BodyLayout {
  id: string;
  poseRef?: unknown;
  /** Bounds in panel twips. The bottom may extend below the panel when zoomed. */
  bbox: Rect;
  /** Mirror the bitmap horizontally. Unflipped characters face right. */
  flip: boolean;
  /** x where balloon tails aim (the face). */
  arrowX: number;
  /** Whether the body is a listener added because someone addressed them. */
  listener: boolean;
}

export interface PanelLayout {
  width: number;
  height: number;
  border: boolean;
  borderWidth: number;
  /** The first panel is an "establishing shot" and never zooms. */
  establishing: boolean;
  zoom: number;
  /** Source rectangle of the backdrop, as fractions of the bitmap (top-left origin). */
  backdropCrop: { x: number; y: number; width: number; height: number };
  bodies: BodyLayout[];
  /** In speaking order. Draw them in reverse so the first balloon ends up on top. */
  balloons: BalloonGeometry[];
}

// panel.cpp constants
const MAXBODIES = 5;
const MAXBALLOONS = 5;
const ONELINETHRESHOLD = 500;
const MINHOOKHEIGHT = 100;
const BORDERWIDTH = 60;
const DEFAULT_UNIT = 4860; // the reference panel width used by fonts.cpp

interface Body {
  id: string;
  pose: PoseSize;
  poseRef?: unknown;
  flip: boolean;
  requested: boolean;
  bbox: Rect;
  arrowX: number;
}

interface AvatarMemory {
  lastDir: boolean;
  lastLeft: string | null;
  lastRight: string | null;
}

class Panel {
  bodies: Body[] = [];
  balloons: Balloon[] = [];
  layout: PanelLayout | null = null;
  zoom = 1;
  fixedY = 0;
  blank = false;

  constructor(readonly seed: number) {}

  clone(): Panel {
    const copy = new Panel(this.seed);
    copy.blank = this.blank;
    copy.bodies = this.bodies.map((b) => ({ ...b, bbox: { ...b.bbox } }));
    copy.balloons = this.balloons.map((b) => {
      const c = b.clone();
      c.speaker = copy.bodies.find((body) => body.id === b.speaker.id) ?? b.speaker;
      return c;
    });
    return copy;
  }

  hasAvatar(id: string): boolean {
    return this.bodies.some((b) => b.id === id);
  }
}

const round = (n: number): number => Math.floor(n + 0.5);

export class ComicPage {
  readonly unitWidth: number;
  readonly unitHeight: number;
  readonly border: boolean;
  private readonly fonts: BalloonFonts;
  private readonly hooks: CastHooks;
  private readonly rng: MsvcRand;
  private readonly memory = new Map<string, AvatarMemory>();
  private panels: Panel[] = [];
  private newPanel = true;

  constructor(options: PageOptions) {
    this.fonts = options.fonts;
    this.unitWidth = Math.max(options.unitWidth ?? DEFAULT_UNIT, 2300);
    this.unitHeight = Math.max(options.unitHeight ?? this.unitWidth, 2300);
    this.border = options.border ?? true;
    this.hooks = { talkTos: options.talkTos, neutralPose: options.neutralPose };
    this.rng = new MsvcRand(options.seed ?? 1);
  }

  get layouts(): PanelLayout[] {
    return this.panels.map((p) => p.layout!).filter(Boolean);
  }

  /**
   * GetRandomTitle, drawn from the page's rand() stream. Call it before the
   * first line, as the original did when opening a new conversation.
   */
  chooseTitle(): string {
    return randomTitle(this.rng);
  }

  /** CPage::StartNewPanel — the next line opens a fresh panel. */
  startNewPanel(): void {
    this.newPanel = true;
  }

  /** Studio-only pacing panel: render the selected backdrop with no cast or balloons. */
  addBlankPanel(): void {
    const panel = new Panel(this.rng.rand());
    panel.blank = true;
    panel.layout = this.snapshot(panel, this.panels.length === 0, new Set());
    this.panels.push(panel);
    // Automatic placement should preserve the empty shot. An explicit
    // stayInPanel beat may still turn it into a populated panel later.
    this.newPanel = true;
  }

  /** CUnitPanelPage::AddLine */
  addLine(line: ComicLine): void {
    if (line.breakBefore) this.startNewPanel();
    if (line.reaction) {
      this.addReaction(line, 0, true);
      return;
    }
    this.addLineAux(line, line.text, line.links ?? [], 0, true);
  }

  /** CUnitPanelPage::AddReaction — place a character without a balloon. */
  private addReaction(line: ComicLine, depth: number, allowStayInPanel: boolean): void {
    const old = this.panels[this.panels.length - 1];
    let panel: Panel;
    let replaceLast: boolean;
    const stayInPanel = allowStayInPanel && line.stayInPanel && old && !old.blank && old.bodies.length < MAXBODIES;
    if (!stayInPanel && (this.newPanel || !old || old.bodies.length >= MAXBODIES || this.panels.length < 2)) {
      panel = new Panel(this.rng.rand());
      this.newPanel = false;
      replaceLast = false;
    } else {
      panel = old.clone();
      replaceLast = true;
    }
    const establishing = this.panels.length === 0 || (replaceLast && this.panels.length === 1);
    const speaker: Body = {
      id: line.speakerId,
      pose: line.pose,
      poseRef: line.poseRef,
      flip: false,
      requested: true,
      bbox: { left: 0, top: 0, right: 0, bottom: 0 },
      arrowX: 0,
    };
    const existing = panel.bodies.findIndex((body) => body.id === line.speakerId);
    if (existing >= 0) panel.bodies[existing] = speaker;
    else panel.bodies.push(speaker);
    for (const balloon of panel.balloons) {
      if (balloon.speaker.id === speaker.id) balloon.speaker = speaker;
    }

    const listeners = this.layoutAvatars(panel, establishing);
    const result = this.layoutBalloons(panel);
    if (!result.ok && depth < 8) {
      this.startNewPanel();
      this.addReaction(line, depth + 1, false);
      return;
    }
    panel.layout = this.snapshot(panel, establishing, listeners);
    if (replaceLast) this.panels[this.panels.length - 1] = panel;
    else this.panels.push(panel);
  }

  private addLineAux(line: ComicLine, text: string, links: readonly BalloonLink[], depth: number, allowStayInPanel: boolean): void {
    const mode = line.mode ?? "say";
    if (mode === "action") this.startNewPanel();

    const old = this.panels[this.panels.length - 1];
    let panel: Panel;
    let replaceLast: boolean;
    const stayInPanel = allowStayInPanel && line.stayInPanel && old && !old.blank && old.balloons.length < MAXBALLOONS;
    if (!stayInPanel && (this.newPanel || !old || old.balloons.length >= MAXBALLOONS || old.hasAvatar(line.speakerId))) {
      panel = new Panel(this.rng.rand());
      this.newPanel = false;
      replaceLast = false;
    } else {
      panel = old.clone();
      replaceLast = true;
    }
    const establishing = this.panels.length === 0 || (replaceLast && this.panels.length === 1);

    // FetchSpeaker + ReplaceBody: the speaker always shows their current pose.
    const speaker: Body = {
      id: line.speakerId,
      pose: line.pose,
      poseRef: line.poseRef,
      flip: false,
      requested: true,
      bbox: { left: 0, top: 0, right: 0, bottom: 0 },
      arrowX: 0,
    };
    const existing = panel.bodies.findIndex((b) => b.id === line.speakerId);
    if (existing >= 0) panel.bodies[existing] = speaker;
    else panel.bodies.push(speaker);
    for (const b of panel.balloons) if (b.speaker.id === speaker.id) b.speaker = speaker;
    panel.balloons.push(new Balloon(text, mode, this.fonts, speaker, links));

    const listeners = this.layoutAvatars(panel, establishing);
    const result = this.layoutBalloons(panel);

    if (!result.ok && depth < 8) {
      this.startNewPanel();
      this.addLineAux(line, text, links, depth + 1, false);
      return;
    }
    panel.layout = this.snapshot(panel, establishing, listeners);
    if (replaceLast) this.panels[this.panels.length - 1] = panel;
    else this.panels.push(panel);
    // Spilled text always shrinks, so this chain terminates without the retry cap.
    if (result.rest) this.addLineAux(line, result.rest.text, result.rest.links, 0, false);
  }

  // -------------------------------------------------------------------------
  // Avatars

  private memoryFor(id: string): AvatarMemory {
    let m = this.memory.get(id);
    if (!m) {
      m = { lastDir: false, lastLeft: null, lastRight: null };
      this.memory.set(id, m);
    }
    return m;
  }

  /** CUnitPanel::LayoutAvatars. Returns the ids of addressed listeners. */
  private layoutAvatars(panel: Panel, establishing: boolean): Set<string> {
    const W = this.unitWidth;
    const H = this.unitHeight;
    const speakers = panel.bodies.filter((b) => b.requested || panel.balloons.some((bl) => bl.speaker.id === b.id));
    const listeners = new Set<string>();
    const records = speakers.slice();
    if (records.length < MAXBODIES) this.addTalkTos(records, listeners);
    const placed = this.greedyOrder(records);

    const maxBodyHeight = Math.trunc(H / 1.9);
    const dims = placed.map((b) => {
      const width = b.pose.width || 100;
      const height = b.pose.height || 100;
      const faceX = b.flip ? width - b.pose.faceX : b.pose.faceX;
      return { width, height, headHeight: Math.trunc(height / 2), arrowFrac: faceX / width };
    });

    // normHeight is a constant 100 for every avatar, so all bodies scale to maxBodyHeight.
    const width: number[] = [];
    const height: number[] = [];
    const top: number[] = [];
    const head: number[] = [];
    let bodyWidth = 0;
    dims.forEach((d, i) => {
      const newHeight = maxBodyHeight;
      const ratio = newHeight / d.height;
      height[i] = newHeight;
      width[i] = round(ratio * d.width);
      top[i] = -H + height[i];
      head[i] = round(ratio * d.headHeight);
      bodyWidth += width[i];
    });

    let zoom = 1.0;
    if (bodyWidth > W) {
      const reduction = W / bodyWidth;
      bodyWidth = 0;
      dims.forEach((_, i) => {
        height[i] = round(height[i] * reduction);
        width[i] = round(width[i] * reduction);
        top[i] = -H + height[i];
        bodyWidth += width[i];
      });
    } else if (!establishing) {
      zoom = W / bodyWidth;
      const headFactor = maxBodyHeight / (Math.max(...head) * 1.2); // don't cut at the neck
      zoom = Math.min(zoom, headFactor);
      if (zoom < 1.1) zoom = 1.0;
      bodyWidth = 0;
      dims.forEach((_, i) => {
        // Tops stay put, so zoomed bodies run off the bottom of the panel.
        height[i] = round(height[i] * zoom);
        width[i] = round(width[i] * zoom);
        bodyWidth += width[i];
      });
    }
    panel.zoom = zoom;
    panel.fixedY = -H + maxBodyHeight;

    const margin = Math.trunc((W - bodyWidth) / (placed.length + 1));
    let x = margin;
    placed.forEach((b, i) => {
      b.bbox = { left: x, right: x + width[i], top: top[i], bottom: top[i] - height[i] };
      b.arrowX = b.bbox.left + round(dims[i].arrowFrac * width[i]);
      x += width[i] + margin;
    });
    panel.bodies = placed;

    // UpdateHistoresis
    placed.forEach((b, i) => {
      const m = this.memoryFor(b.id);
      m.lastDir = b.flip;
      if (i > 0) m.lastRight = placed[i - 1].id;
      if (i < placed.length - 1) m.lastLeft = placed[i + 1].id;
    });
    return listeners;
  }

  /** AddTalkTos: pull addressed listeners into the panel (at most five bodies). */
  private addTalkTos(records: Body[], listeners: Set<string>): void {
    const talkTos = this.hooks.talkTos;
    if (!talkTos) return;
    const initial = records.length;
    for (let i = 0; i < initial; i += 1) {
      for (const target of talkTos(records[i].id)) {
        if (records.length >= MAXBODIES) return;
        if (records.some((r) => r.id === target)) continue;
        const neutral = this.hooks.neutralPose?.(target);
        if (!neutral) continue;
        records.push({
          id: target,
          pose: neutral.pose,
          poseRef: neutral.poseRef,
          flip: false,
          requested: false,
          bbox: { left: 0, top: 0, right: 0, bottom: 0 },
          arrowX: 0,
        });
        listeners.add(target);
      }
    }
  }

  /** DoGreedyOrdering: insert each body where it scores best, choosing its facing. */
  private greedyOrder(records: Body[]): Body[] {
    const placed: Body[] = [];
    for (const body of records) {
      let bestRating = Infinity;
      let bestPosition = placed.length;
      let bestDir = false;
      for (let j = 0; j <= placed.length; j += 1) {
        const { rating, dir } = this.evalPlacement(placed, body, j);
        if (rating < bestRating) {
          bestRating = rating;
          bestPosition = j;
          bestDir = dir;
        }
      }
      body.flip = bestDir;
      placed.splice(bestPosition, 0, body);
    }
    return placed;
  }

  private evalPlacement(placed: Body[], body: Body, index: number): { rating: number; dir: boolean } {
    const trial = placed.slice();
    trial.splice(index, 0, body);
    const penalty = this.displacementPenalty(trial);
    const rate = (): number => {
      let rating = penalty;
      for (let i = 0; i < trial.length; i += 1) {
        for (let j = i + 1; j < trial.length; j += 1) {
          rating += this.evalPair(trial[i], trial[j], j - i) + this.evalPair(trial[j], trial[i], i - j);
        }
      }
      return rating;
    };
    body.flip = false;
    const ratingR = rate();
    body.flip = true;
    const ratingL = rate();
    if (ratingR < ratingL) return { rating: ratingR, dir: false };
    if (ratingR > ratingL) return { rating: ratingL, dir: true };
    return { rating: ratingR, dir: this.memoryFor(body.id).lastDir };
  }

  /** ComputeDisplacementPenalty: prefer keeping yesterday's neighbours. */
  private displacementPenalty(order: Body[]): number {
    let penalty = 0;
    order.forEach((b, i) => {
      const m = this.memoryFor(b.id);
      if (i > 0 && m.lastRight !== order[i - 1].id) penalty += 1;
      if (i < order.length - 1 && m.lastLeft !== order[i + 1].id) penalty += 1;
    });
    return penalty;
  }

  /** EvalPair: face the people you talk to, and sit next to them. */
  private evalPair(b1: Body, b2: Body, deltaPlacement: number): number {
    let rating = 0;
    let desiredDir: boolean;
    if (deltaPlacement > 0) desiredDir = false;
    else {
      desiredDir = true;
      deltaPlacement = -deltaPlacement;
    }
    const talkTos = this.hooks.talkTos?.(b1.id) ?? [];
    if (talkTos.length === 0) {
      if (b1.flip !== desiredDir) rating += 4; // talking to the world, but not facing the other
      if (b2.flip === desiredDir) rating += 2; // ...and the other is facing away
    } else {
      for (const target of talkTos) {
        if (target !== b2.id) continue;
        if (b1.flip === desiredDir) rating += 4 * (deltaPlacement - 1);
        else rating += 40; // facing away from the person I'm addressing
        if (b2.flip === desiredDir) rating += 4;
      }
    }
    return rating;
  }

  // -------------------------------------------------------------------------
  // Balloons

  /** CUnitPanel::GetBalloonRect — the top half of the panel, inside the border. */
  private balloonRect(): Rect {
    const r = { left: 0, top: 0, right: this.unitWidth, bottom: -Math.trunc(this.unitHeight / 2) };
    if (this.border) {
      r.left += BORDERWIDTH;
      r.right -= BORDERWIDTH;
      r.top -= BORDERWIDTH;
    }
    return r;
  }

  /** CUnitPanel::LayoutBalloons */
  private layoutBalloons(panel: Panel): { ok: boolean; rest: { text: string; links: BalloonLink[] } | null } {
    const free = this.balloonRect();
    this.rng.srand(panel.seed); // always lay a panel out the same random way
    const balloons = panel.balloons;
    for (let i = 0; i < balloons.length; i += 1) {
      if (this.layoutBalloon(balloons, i, free)) continue;
      if (i === 0 && balloons.length === 1) {
        return { ok: true, rest: this.forceFit(balloons[0], free) };
      }
      return { ok: false, rest: null };
    }
    return { ok: true, rest: null };
  }

  /** ForceFitBalloon: fill the whole balloon area and spill the rest onward. */
  private forceFit(balloon: Balloon, free: Rect): { text: string; links: BalloonLink[] } | null {
    balloon.setBBox(free.left, free.top, free.right, this.rng);
    const rest = balloon.splitHeight(free.top - free.bottom, this.rng);
    if (balloon.box.top > -250) balloon.dockAtTop(free.top);
    // Deviation: the original leaves the route region from the failed attempt;
    // recomputing it keeps the tail under the balloon that is actually drawn.
    balloon.routeRgn = balloon.cloudBox();
    return rest;
  }

  /** GetCloudEstimate: pick a width and a random x that overlaps the speaker. */
  private cloudEstimate(balloons: Balloon[], index: number, free: Rect): { left: number; right: number } {
    const balloon = balloons[index];
    const { area, len } = balloon.areaEstimate();
    const maxWidth = free.right - free.left;
    let goalWidth: number;
    if (len <= ONELINETHRESHOLD) {
      goalWidth = len;
    } else {
      // canBeTall is always TRUE in the shipped code.
      let lowY = free.top;
      for (let i = 0; i < index; i += 1) lowY = Math.min(lowY, balloons[i].box.bottom);
      const potentialHeight = lowY - free.bottom + MINHOOKHEIGHT;
      const minWidth = Math.max(Math.trunc(area / potentialHeight), balloon.widestWord());
      goalWidth = minWidth + Math.trunc(this.rng.randfloat() * (maxWidth - minWidth));
    }
    goalWidth = Math.min(goalWidth + 200, maxWidth);
    goalWidth = Math.min(goalWidth, len + 200);
    let left: number;
    if (balloon.isBox) left = free.left;
    else {
      const toX = balloon.speaker.arrowX;
      const leftLimit = toX - goalWidth;
      let startX = leftLimit + Math.trunc(this.rng.randfloat() * (toX - leftLimit));
      if (startX < free.left) startX = free.left;
      if (startX + goalWidth > free.right) startX = free.right - goalWidth;
      left = startX;
    }
    return { left, right: left + goalWidth };
  }

  /** GetInterveningBBox: keep clear of earlier tails and stack in reading order. */
  private interveningBox(balloons: Balloon[], index: number, free: Rect, rect: { left: number; right: number }): number {
    const toX = balloons[index].speaker.arrowX;
    let mostLeft = free.left;
    let mostRight = free.right;
    for (let i = 0; i < index; i += 1) {
      const allowance = balloons[i].queryRouteRgn(toX);
      mostLeft = Math.max(allowance.left, mostLeft);
      mostRight = Math.min(allowance.right, mostRight);
    }
    if (mostLeft > rect.left || mostRight < rect.right) {
      if (mostRight - mostLeft >= rect.right - rect.left) {
        const delta = mostLeft > rect.left ? mostLeft - rect.left : mostRight - rect.right;
        rect.left += delta;
        rect.right += delta;
      } else {
        rect.left = mostLeft;
        rect.right = mostRight;
      }
    }
    // Earlier balloons entirely to the left cap our top at their top; anything
    // else overlapping or to the right pushes us below it (docked by 90).
    const dock = TOPBORDER + 40 + 70;
    let top = free.top;
    for (let i = 0; i < index; i += 1) {
      const cloud = balloons[i].cloudBox();
      if (cloud.right < rect.left) top = Math.min(top, cloud.top);
      else top = Math.min(top, cloud.bottom + dock);
    }
    return top;
  }

  /** CUnitPanel::LayoutBalloon */
  private layoutBalloon(balloons: Balloon[], index: number, free: Rect): boolean {
    const rect = this.cloudEstimate(balloons, index, free);
    const top = this.interveningBox(balloons, index, free, rect);
    const balloon = balloons[index];
    if (!balloon.setBBox(rect.left, top, rect.right, this.rng)) return false;
    if (balloon.box.top > -250) balloon.dockAtTop(free.top);
    balloon.routeRgn = balloon.cloudBox();
    if (balloon.routeRgn.bottom < free.bottom + MINHOOKHEIGHT) return false;
    // AdjustRouteRgns: earlier balloons give up the strip this one's tail needs.
    const toX = balloon.speaker.arrowX;
    for (let i = 0; i < index; i += 1) balloons[i].setRouteRgn(toX, balloon.routeRgn.left, balloon.routeRgn.right);
    return true;
  }

  // -------------------------------------------------------------------------

  private snapshot(panel: Panel, establishing: boolean, listeners: Set<string>): PanelLayout {
    const W = this.unitWidth;
    const H = this.unitHeight;
    const { zoom, fixedY } = panel;
    // AdjustArtToCoord: the backdrop zooms about fixedY, anchored at the left edge.
    const logHeight = round(H / zoom);
    const logWidth = round(W / zoom);
    const delta = fixedY - round(fixedY / zoom);
    return {
      width: W,
      height: H,
      border: this.border,
      borderWidth: BORDERWIDTH,
      establishing,
      zoom,
      backdropCrop: { x: 0, y: -delta / H, width: logWidth / W, height: logHeight / H },
      bodies: panel.bodies.map((b) => ({
        id: b.id,
        poseRef: b.poseRef,
        bbox: { ...b.bbox },
        flip: b.flip,
        arrowX: b.arrowX,
        listener: listeners.has(b.id),
      })),
      balloons: panel.balloons.map((b) => b.geometry()),
    };
  }
}
