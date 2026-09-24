// Turn ordinary RGBA images into Comic Chat art, in the same encodings the
// shipped characters use, and assemble them into an AvbDocument that
// writeAvbDocument() can save:
//
//   "mono"   2 bpp AIP_MASKEDMONO — black ink, white fill, a white aura; the
//            classic look (Anna, Dan, Tux...).
//   "color"  8 bpp local palette plus a 2 bpp AIP_DUALMASK figure/aura mask,
//            as Kirby is stored.
//
// Icons are 40×40 with a local palette, like every shipped character.

import type { Rgb } from "./avb";
import { AvatarFlag, AvbPalette, AvbType, dibStride, type AvbDocument, type AvbImage, type AvbPose } from "./avb-document";

export interface Rgba {
  width: number;
  height: number;
  /** Row-major, top-down, 4 bytes per pixel. */
  pixels: Uint8ClampedArray | Uint8Array;
}

export type ArtStyle = "mono" | "color";

export interface EncodeOptions {
  /** Width in pixels of the white halo drawn around the figure (0 for none). */
  aura?: number;
  /** Alpha at or above this counts as part of the figure. */
  alphaThreshold?: number;
  /** Mono only: luminance below this is ink. */
  inkThreshold?: number;
}

/** 96 dpi, as most shipped art records. */
const PELS_PER_METER = 3779;

const alphaAt = (img: Rgba, x: number, y: number) => img.pixels[(y * img.width + x) * 4 + 3];
const lumaAt = (img: Rgba, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return 0.299 * img.pixels[i] + 0.587 * img.pixels[i + 1] + 0.114 * img.pixels[i + 2];
};

/** Figure mask and its dilation by `radius` (the aura), both top-down. */
function masks(img: Rgba, options: EncodeOptions): { figure: Uint8Array; aura: Uint8Array } {
  const threshold = options.alphaThreshold ?? 128;
  const radius = Math.max(0, Math.round(options.aura ?? 3));
  const { width, height } = img;
  const figure = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) figure[y * width + x] = alphaAt(img, x, y) >= threshold ? 1 : 0;
  if (radius === 0) return { figure, aura: figure.slice() };
  // Separable square dilation, then trimmed to a disc by distance.
  const aura = new Uint8Array(width * height);
  const r2 = radius * radius;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!figure[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || dx * dx + dy * dy > r2) continue;
          aura[yy * width + xx] = 1;
        }
      }
    }
  }
  return { figure, aura };
}

/** Pack top-down indices into bottom-up DIB rows of the given depth. */
function packRows(width: number, height: number, bitCount: 2 | 4 | 8, index: (x: number, y: number) => number): Uint8Array {
  const stride = dibStride(width, bitCount);
  const bits = new Uint8Array(stride * height);
  const perByte = 8 / bitCount;
  for (let y = 0; y < height; y += 1) {
    const row = (height - 1 - y) * stride; // bottom-up
    for (let x = 0; x < width; x += 1) {
      const value = index(x, y);
      const byte = row + Math.floor(x / perByte);
      const shift = 8 - bitCount * ((x % perByte) + 1);
      bits[byte] |= value << shift;
    }
  }
  return bits;
}

/** Masked monochrome: 00 blank, 01 aura, 10 white figure, 11 black figure. */
export function encodeMono(img: Rgba, options: EncodeOptions = {}): AvbImage {
  const ink = options.inkThreshold ?? 128;
  const { figure, aura } = masks(img, options);
  return {
    width: img.width,
    height: img.height,
    bitCount: 2,
    paletteType: AvbPalette.MaskedMono,
    bits: packRows(img.width, img.height, 2, (x, y) => {
      const i = y * img.width + x;
      if (figure[i]) return lumaAt(img, x, y) < ink ? 3 : 2;
      return aura[i] ? 1 : 0;
    }),
    xPelsPerMeter: PELS_PER_METER,
    yPelsPerMeter: PELS_PER_METER,
    clrUsed: 4,
    clrImportant: 4,
  };
}

// ---------------------------------------------------------------------------
// Colour: median-cut quantisation to a local palette

function medianCut(colors: Rgb[], counts: number[], max: number): Rgb[] {
  type Box = number[];
  const range = (box: Box, c: keyof Rgb) => {
    let lo = 255;
    let hi = 0;
    for (const i of box) {
      lo = Math.min(lo, colors[i][c]);
      hi = Math.max(hi, colors[i][c]);
    }
    return hi - lo;
  };
  let boxes: Box[] = [colors.map((_, i) => i)];
  while (boxes.length < max) {
    let best = -1;
    let bestRange = 0;
    let channel: keyof Rgb = "r";
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const c of ["r", "g", "b"] as const) {
        const r = range(box, c);
        if (r > bestRange) {
          bestRange = r;
          best = i;
          channel = c;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => colors[a][channel] - colors[b][channel]);
    const total = box.reduce((sum, i) => sum + counts[i], 0);
    let acc = 0;
    let cut = 1;
    for (; cut < box.length - 1; cut += 1) {
      acc += counts[box[cut - 1]];
      if (acc >= total / 2) break;
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const i of box) {
      r += colors[i].r * counts[i];
      g += colors[i].g * counts[i];
      b += colors[i].b * counts[i];
      n += counts[i];
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  });
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Build a palette (≤ maxColors, white first) and a nearest-colour lookup. */
function quantize(img: Rgba, include: (i: number) => boolean, maxColors: number): { palette: Rgb[]; indexOf: (x: number, y: number) => number } {
  const histogram = new Map<number, number>();
  const n = img.width * img.height;
  for (let i = 0; i < n; i += 1) {
    if (!include(i)) continue;
    const p = i * 4;
    const key = (img.pixels[p] << 16) | (img.pixels[p + 1] << 8) | img.pixels[p + 2];
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const keys = [...histogram.keys()];
  const colors = keys.map((k) => ({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255 }));
  const counts = keys.map((k) => histogram.get(k)!);
  const chosen = colors.length <= maxColors - 1 ? colors : medianCut(colors, counts, maxColors - 1);
  const palette = [WHITE, ...chosen.filter((c) => !(c.r === 255 && c.g === 255 && c.b === 255))];
  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number) => {
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (hit === undefined) {
      let best = Infinity;
      hit = 0;
      palette.forEach((c, i) => {
        const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
        if (d < best) {
          best = d;
          hit = i;
        }
      });
      cache.set(key, hit);
    }
    return hit;
  };
  return {
    palette,
    indexOf: (x, y) => {
      const p = (y * img.width + x) * 4;
      return nearest(img.pixels[p], img.pixels[p + 1], img.pixels[p + 2]);
    },
  };
}

/** 8 bpp local-palette image plus a dual mask (bit 0 figure, bit 1 aura). */
export function encodeColor(img: Rgba, options: EncodeOptions = {}): { image: AvbImage; mask: AvbImage } {
  const { figure, aura } = masks(img, options);
  const { palette, indexOf } = quantize(img, (i) => figure[i] === 1, 256);
  const image: AvbImage = {
    width: img.width,
    height: img.height,
    bitCount: 8,
    paletteType: AvbPalette.Local,
    palette,
    // Outside the figure the art must be white: it is drawn with SRCAND.
    bits: packRows(img.width, img.height, 8, (x, y) => (figure[y * img.width + x] ? indexOf(x, y) : 0)),
    xPelsPerMeter: PELS_PER_METER,
    yPelsPerMeter: PELS_PER_METER,
    clrUsed: palette.length,
    clrImportant: palette.length,
  };
  const mask: AvbImage = {
    width: img.width,
    height: img.height,
    bitCount: 2,
    paletteType: AvbPalette.DualMask,
    bits: packRows(img.width, img.height, 2, (x, y) => {
      const i = y * img.width + x;
      return (figure[i] ? 1 : 0) | (aura[i] ? 2 : 0);
    }),
    xPelsPerMeter: PELS_PER_METER,
    yPelsPerMeter: PELS_PER_METER,
    clrUsed: 4,
    clrImportant: 4,
  };
  return { image, mask };
}

/** Scale any image to the 40×40 icon every shipped character has (16 colours). */
export function encodeIcon(img: Rgba): AvbImage {
  const size = 40;
  const scale = Math.max(img.width, img.height) / size;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  const offX = (size - img.width / scale) / 2;
  const offY = (size - img.height / scale) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.floor((x - offX) * scale);
      const sy = Math.floor((y - offY) * scale);
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const s = (sy * img.width + sx) * 4;
      const a = img.pixels[s + 3] / 255;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) pixels[o + c] = Math.round(img.pixels[s + c] * a + 255 * (1 - a));
    }
  }
  const square: Rgba = { width: size, height: size, pixels };
  const { palette, indexOf } = quantize(square, () => true, 16);
  return {
    width: size,
    height: size,
    bitCount: 4,
    paletteType: AvbPalette.Local,
    palette,
    bits: packRows(size, size, 4, indexOf),
    xPelsPerMeter: PELS_PER_METER,
    yPelsPerMeter: PELS_PER_METER,
    clrUsed: palette.length,
    clrImportant: palette.length,
  };
}

// ---------------------------------------------------------------------------
// Assembling characters

/** Emotion indices stored in pose records (avatario.cpp emFloats order). */
export const Emotion = {
  Happy: 1,
  Coy: 2,
  Bored: 3,
  Scared: 4,
  Sad: 5,
  Angry: 6,
  Shout: 7,
  Laugh: 8,
  Neutral: 9,
  Wave: 10,
  PointOther: 11,
  PointSelf: 12,
  DoublePoint: 13,
  Shrug: 14,
} as const;

export interface PoseInput {
  art: Rgba;
  emotion: number;
  /** 0–1 */
  intensity: number;
  /** Face position in the art (bodies and faces). */
  face?: { x: number; y: number };
}

export interface FaceInput extends PoseInput {
  /** The point on the head that attaches to the torso's neck. */
  neck: { x: number; y: number };
}

export interface TorsoInput extends Omit<PoseInput, "face"> {
  /** Where the head's neck point sits on this torso. */
  neck: { x: number; y: number };
}

export interface CharacterMeta {
  name: string;
  /** Shown as the art's credit, e.g. "© 2026 Jane Doe · CC BY 4.0". */
  copyright?: string;
  /** Where the finished .avb is published; sent with "# Appears as". */
  url?: string;
  style?: ArtStyle;
  encode?: EncodeOptions;
  /** Defaults to the first pose's art. */
  icon?: Rgba;
}

class ImageTable {
  readonly images: AvbImage[] = [];
  add(image: AvbImage): number {
    this.images.push(image);
    return this.images.length - 1;
  }
}

function encodePose(table: ImageTable, input: PoseInput, style: ArtStyle, options: EncodeOptions): Pick<AvbPose, "image" | "mask" | "aura"> {
  if (style === "mono") return { image: table.add(encodeMono(input.art, options)), mask: null, aura: null };
  const { image, mask } = encodeColor(input.art, options);
  return { image: table.add(image), mask: table.add(mask), aura: null };
}

const intensityByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));

/** A character with one picture per pose (CAvatarSimple). */
export function createSimpleCharacter(meta: CharacterMeta, poses: PoseInput[]): AvbDocument {
  if (!poses.length) throw new Error("Add at least one pose");
  const style = meta.style ?? "mono";
  const table = new ImageTable();
  const icon = table.add(encodeIcon(meta.icon ?? poses[0].art));
  const bodies = poses.map((p) => ({
    ...encodePose(table, p, style, meta.encode ?? {}),
    emotion: p.emotion,
    intensity: intensityByte(p.intensity),
    x: p.face?.x ?? Math.round(p.art.width / 2),
    y: p.face?.y ?? Math.round(p.art.height / 5),
  }));
  return {
    type: AvbType.Simple,
    version: 2,
    name: meta.name,
    style: 1,
    flags: 0,
    ...(meta.copyright ? { copyright: meta.copyright } : {}),
    ...(meta.url ? { originalUrl: meta.url } : {}),
    icon,
    bodies,
    faces: [],
    torsos: [],
    images: table.images,
  };
}

/** A character assembled from separate heads and torsos (CAvatarComplex). */
export function createHeadAndTorsoCharacter(meta: CharacterMeta, faces: FaceInput[], torsos: TorsoInput[]): AvbDocument {
  if (!faces.length || !torsos.length) throw new Error("Add at least one face and one torso");
  const style = meta.style ?? "mono";
  const table = new ImageTable();
  const icon = table.add(encodeIcon(meta.icon ?? faces[0].art));
  return {
    type: AvbType.Complex,
    version: 2,
    name: meta.name,
    style: 1,
    // Torso drawn first, head masked over it — what every shipped composite uses.
    flags: AvatarFlag.HeadMask | AvatarFlag.TorsoFirst,
    ...(meta.copyright ? { copyright: meta.copyright } : {}),
    ...(meta.url ? { originalUrl: meta.url } : {}),
    icon,
    bodies: [],
    faces: faces.map((f) => ({
      ...encodePose(table, f, style, meta.encode ?? {}),
      emotion: f.emotion,
      intensity: intensityByte(f.intensity),
      x: f.face?.x ?? Math.round(f.art.width / 2),
      y: f.face?.y ?? Math.round(f.art.height / 2),
      anchor: { cx: f.neck.x, cy: f.neck.y, cxDelta: 0, cyDelta: 0 },
    })),
    torsos: torsos.map((t) => ({
      ...encodePose(table, t, style, meta.encode ?? {}),
      emotion: t.emotion,
      intensity: intensityByte(t.intensity),
      x: t.neck.x,
      y: t.neck.y,
    })),
    images: table.images,
  };
}

/** A backdrop (.bgb) from any image, stored as the shipped ones are: 8 bpp local palette. */
export function createBackdrop(meta: Pick<CharacterMeta, "copyright" | "url">, art: Rgba): AvbDocument {
  const opaque: Rgba = { ...art, pixels: Uint8ClampedArray.from(art.pixels, (v, i) => (i % 4 === 3 ? 255 : v)) };
  const { palette, indexOf } = quantize(opaque, () => true, 256);
  const image: AvbImage = {
    width: art.width,
    height: art.height,
    bitCount: 8,
    paletteType: AvbPalette.Local,
    palette,
    bits: packRows(art.width, art.height, 8, indexOf),
    xPelsPerMeter: PELS_PER_METER,
    yPelsPerMeter: PELS_PER_METER,
    clrUsed: palette.length,
    clrImportant: palette.length,
  };
  return {
    type: AvbType.Backdrop,
    version: 2,
    ...(meta.copyright ? { copyright: meta.copyright } : {}),
    ...(meta.url ? { originalUrl: meta.url } : {}),
    backdrop: 0,
    bodies: [],
    faces: [],
    torsos: [],
    images: [image],
  };
}
