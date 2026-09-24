// Lossless read/write of Comic Chat version 2 art files (.avb characters and
// .bgb backdrops), ported from the Avatar Filer in artifacts/avtools
// (avbfile.cpp / avbfile2.cpp). avb.ts decodes art for display; this module
// keeps every record and the raw bitmap bits so a file can be edited and
// written back out, or a new character assembled from scratch.
//
// File layout (little-endian):
//   header    u16 magic 0x8181, u16 type (1 simple, 2 complex, 3 backdrop), u16 version (2)
//   records   u16 tag, then a payload. Tags >= 256 carry a u16 payload size.
//   data      AK_STARTDATA, the images each pose record points at, AK_ENDDATA
// An image is an optional local palette record, a BITMAPINFOHEADER, then
// u32 raw size, u32 compressed size and zlib data (format 1, "LZDEFLATE").

import type { Rgb } from "./avb";

export const AVB_MAGIC = 0x8181;
export const AVB_VERSION = 2;

/** AVATARRECORDTYPE in avbfile.h */
export const Tag = {
  Name: 1,
  Flags: 2,
  StartData: 6,
  EndData: 7,
  Style: 8,
  Faces: 10,
  Torsos: 11,
  Bodies: 12,
  Icon: 256,
  Palette: 257,
  Backdrop: 258,
  Copyright: 259,
  OriginalUrl: 260,
  OverrideUrl: 261,
  UsageFlags: 262,
  OffsetAdjustment: 263,
} as const;

export const enum AvbType {
  Simple = 1,
  Complex = 2,
  Backdrop = 3,
}

/** AVATARIMAGEPALETTE */
export const enum AvbPalette {
  None = 0,
  Global = 1,
  Local = 2,
  Monochrome = 3,
  /** 2 bpp: 00 blank, 01 aura, 10 black, 11 white — image, mask and aura in one. */
  MaskedMono = 4,
  /** 2 bpp: bit 0 = figure mask, bit 1 = aura. Used with a colour image. */
  DualMask = 5,
}

/** avatar.h flags */
export const AvatarFlag = { HeadMask: 1, TorsoMask: 2, TorsoFirst: 4 } as const;

/** A DIB exactly as stored: raw rows (DWORD-aligned, bottom-up when height > 0). */
export interface AvbImage {
  width: number;
  /** Signed, as in BITMAPINFOHEADER: positive means rows are stored bottom-up. */
  height: number;
  bitCount: 1 | 2 | 4 | 8 | 24 | 32;
  paletteType: AvbPalette;
  /** Only for AvbPalette.Local. */
  palette?: Rgb[];
  bits: Uint8Array;
  xPelsPerMeter?: number;
  yPelsPerMeter?: number;
  clrUsed?: number;
  clrImportant?: number;
}

/** One pose record. Image references are indices into AvbDocument.images. */
export interface AvbPose {
  image: number | null;
  mask: number | null;
  aura: number | null;
  /** Emotion index as stored (see expression.ts EM_FLOATS). */
  emotion: number;
  /** 0–255 */
  intensity: number;
  /** Bodies and faces: face position. Torsos: neck position (signed). */
  x: number;
  y: number;
  /** Faces only: attachment point and offset relative to the torso's neck. */
  anchor?: { cx: number; cy: number; cxDelta: number; cyDelta: number };
}

export interface AvbDocument {
  type: AvbType;
  version: number;
  name?: string;
  style?: number;
  flags?: number;
  copyright?: string;
  /** Where this character can be downloaded (shared with "# Appears as"). */
  originalUrl?: string;
  overrideUrl?: string;
  usageFlags?: number;
  globalPalette?: Rgb[];
  icon?: number | null;
  backdrop?: number | null;
  bodies: AvbPose[];
  faces: AvbPose[];
  torsos: AvbPose[];
  images: AvbImage[];
  /** Sized records this module doesn't understand, kept verbatim. */
  unknownRecords?: { tag: number; payload: Uint8Array }[];
}

export const dibStride = (width: number, bitCount: number): number => Math.ceil((width * bitCount) / 32) * 4;

// ---------------------------------------------------------------------------
// Compression (zlib format, as ZLIB::compress2 wrote it)

async function pump(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const output = new Blob([new Uint8Array(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export const deflate = (data: Uint8Array): Promise<Uint8Array> => pump(data, new CompressionStream("deflate"));
export const inflate = (data: Uint8Array): Promise<Uint8Array> => pump(data, new DecompressionStream("deflate"));

// ---------------------------------------------------------------------------
// Reading

class In {
  readonly view: DataView;
  offset = 0;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number): void {
    if (this.offset + n > this.bytes.byteLength) throw new Error("Unexpected end of Comic Chat art file");
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  take(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  cString(max: number): string {
    const start = this.offset;
    while (this.offset - start < max) {
      if (this.u8() === 0) return new TextDecoder("windows-1252").decode(this.bytes.subarray(start, this.offset - 1));
    }
    throw new Error("Unterminated string in Comic Chat art file");
  }
}

function readPalette(r: In): Rgb[] {
  const count = r.u16();
  if (count > 256) throw new Error(`Palette too large: ${count}`);
  return Array.from({ length: count }, () => ({ r: r.u8(), g: r.u8(), b: r.u8() }));
}

interface RawRef {
  offset: number;
  format: number;
  paletteType: AvbPalette;
}

/** Limits that keep a hostile file from exhausting memory. */
const MAX_DIMENSION = 4096;
const MAX_IMAGES = 1024;

async function readImage(bytes: Uint8Array, ref: RawRef): Promise<AvbImage> {
  if (ref.format !== 1) throw new Error(`Unsupported image format ${ref.format}`);
  const r = new In(bytes);
  r.offset = ref.offset;
  let palette: Rgb[] | undefined;
  if (ref.paletteType === AvbPalette.Local) {
    if (r.u16() !== Tag.Palette) throw new Error("Missing local palette record");
    const size = r.u16();
    const start = r.offset;
    palette = readPalette(r);
    r.offset = start + size;
  }
  const headerSize = r.u32();
  if (headerSize < 40 || headerSize > 240) throw new Error(`Invalid bitmap header size ${headerSize}`);
  const width = r.i32();
  const height = r.i32();
  const planes = r.u16();
  const bitCount = r.u16() as AvbImage["bitCount"];
  const compression = r.u32();
  r.u32(); // biSizeImage (recomputed on write)
  const xPelsPerMeter = r.i32();
  const yPelsPerMeter = r.i32();
  const clrUsed = r.u32();
  const clrImportant = r.u32();
  if (headerSize > 40) r.take(headerSize - 40);
  if (planes !== 1 || compression !== 0 || ![1, 2, 4, 8, 24, 32].includes(bitCount)) {
    throw new Error("Unsupported bitmap layout");
  }
  if (width <= 0 || width > MAX_DIMENSION || height === 0 || Math.abs(height) > MAX_DIMENSION) {
    throw new Error(`Bitmap dimensions out of range: ${width}×${height}`);
  }
  const rawSize = r.u32();
  const packedSize = r.u32();
  const expected = dibStride(width, bitCount) * Math.abs(height);
  if (rawSize !== expected) throw new Error("Bitmap size does not match its dimensions");
  const bits = await inflate(r.take(packedSize));
  if (bits.byteLength !== rawSize) throw new Error("Bitmap decompressed to an unexpected size");
  return {
    width,
    height,
    bitCount,
    paletteType: ref.paletteType,
    ...(palette ? { palette } : {}),
    bits,
    xPelsPerMeter,
    yPelsPerMeter,
    clrUsed,
    clrImportant,
  };
}

/** Parse a .avb or .bgb file into an editable document. */
export async function readAvbDocument(input: ArrayBuffer | Uint8Array): Promise<AvbDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const r = new In(bytes);
  if (r.u16() !== AVB_MAGIC) throw new Error("This is not a version 2 Comic Chat art file");
  const type = r.u16() as AvbType;
  const version = r.u16();
  const doc: AvbDocument = { type, version, bodies: [], faces: [], torsos: [], images: [] };
  let adjustment = 0;
  const refs: RawRef[] = [];
  const refIndex = new Map<string, number>();
  const ref = (offset: number, format: number, paletteType: AvbPalette): number | null => {
    if (offset === 0) return null;
    const absolute = offset + adjustment;
    const key = `${absolute}:${format}:${paletteType}`;
    let index = refIndex.get(key);
    if (index === undefined) {
      index = refs.length;
      if (index >= MAX_IMAGES) throw new Error("Too many images");
      refs.push({ offset: absolute, format, paletteType });
      refIndex.set(key, index);
    }
    return index;
  };
  const readPoses = (kind: "body" | "face" | "torso"): AvbPose[] => {
    const count = r.u16();
    if (count > 512) throw new Error(`Too many poses: ${count}`);
    const raw = Array.from({ length: count }, () => {
      const offsets = [r.u32(), r.u32(), r.u32()];
      const emotion = r.u16();
      const intensity = r.u8();
      let anchor: AvbPose["anchor"];
      let x: number;
      let y: number;
      if (kind === "face") {
        anchor = { cx: r.i16(), cy: r.i16(), cxDelta: r.i16(), cyDelta: r.i16() };
        x = r.i16();
        y = r.i16();
      } else {
        x = r.i16();
        y = r.i16();
      }
      const formats = [r.u8(), r.u8(), r.u8()];
      const palettes = [r.u8(), r.u8(), r.u8()] as AvbPalette[];
      return { offsets, emotion, intensity, x, y, anchor, formats, palettes };
    });
    return raw.map((p) => ({
      image: ref(p.offsets[0], p.formats[0], p.palettes[0]),
      mask: ref(p.offsets[1], p.formats[1], p.palettes[1]),
      aura: ref(p.offsets[2], p.formats[2], p.palettes[2]),
      emotion: p.emotion,
      intensity: p.intensity,
      x: p.x,
      y: p.y,
      ...(p.anchor ? { anchor: p.anchor } : {}),
    }));
  };

  for (;;) {
    const tag = r.u16();
    if (tag === Tag.StartData) break;
    if (tag >= 256) {
      const size = r.u16();
      const start = r.offset;
      const payload = new In(r.take(size));
      switch (tag) {
        case Tag.OffsetAdjustment:
          adjustment += payload.i32();
          break;
        case Tag.Copyright:
          doc.copyright = payload.cString(size);
          break;
        case Tag.OriginalUrl:
          doc.originalUrl = payload.cString(size);
          break;
        case Tag.OverrideUrl:
          doc.overrideUrl = payload.cString(size);
          break;
        case Tag.UsageFlags:
          doc.usageFlags = payload.u8();
          break;
        case Tag.Palette:
          doc.globalPalette = readPalette(payload);
          break;
        case Tag.Icon:
          doc.icon = ref(payload.u32(), payload.u8(), payload.u8());
          break;
        case Tag.Backdrop:
          doc.backdrop = ref(payload.u32(), payload.u8(), payload.u8());
          break;
        default:
          (doc.unknownRecords ??= []).push({ tag, payload: bytes.slice(start, start + size) });
      }
      continue;
    }
    switch (tag) {
      case Tag.Name:
        doc.name = r.cString(256);
        break;
      case Tag.Flags:
        doc.flags = r.u16();
        break;
      case Tag.Style:
        doc.style = r.u16();
        break;
      case Tag.Bodies:
        doc.bodies = readPoses("body");
        break;
      case Tag.Faces:
        doc.faces = readPoses("face");
        break;
      case Tag.Torsos:
        doc.torsos = readPoses("torso");
        break;
      default:
        throw new Error(`Unsupported legacy record ${tag}`);
    }
  }

  doc.images = await Promise.all(refs.map((ref) => readImage(bytes, ref)));
  return doc;
}

// ---------------------------------------------------------------------------
// Writing

class Out {
  private chunks: Uint8Array[] = [];
  length = 0;
  private patches: { at: number; image: number }[] = [];

  bytes(data: Uint8Array): void {
    this.chunks.push(data);
    this.length += data.byteLength;
  }
  private fixed(size: number, fill: (view: DataView) => void): void {
    const buffer = new Uint8Array(size);
    fill(new DataView(buffer.buffer));
    this.bytes(buffer);
  }
  u8(v: number): void {
    this.fixed(1, (d) => d.setUint8(0, v));
  }
  u16(v: number): void {
    this.fixed(2, (d) => d.setUint16(0, v, true));
  }
  i16(v: number): void {
    this.fixed(2, (d) => d.setInt16(0, v, true));
  }
  u32(v: number): void {
    this.fixed(4, (d) => d.setUint32(0, v, true));
  }
  i32(v: number): void {
    this.fixed(4, (d) => d.setInt32(0, v, true));
  }
  cString(s: string): void {
    const bytes = encodeWindows1252(s);
    this.bytes(bytes);
    this.u8(0);
  }
  /** CAvatarFileResourceResolver::WriteResourceReference */
  reference(image: number | null | undefined): void {
    if (image !== null && image !== undefined) this.patches.push({ at: this.length, image });
    this.u32(0);
  }
  /** A sized record (tag >= 256): BeginVariableSection / EndVariableSection. */
  record(tag: number, body: (out: Out) => void): void {
    const inner = new Out();
    body(inner);
    if (inner.length > 0xffff) throw new Error(`Record ${tag} is too large`);
    this.u16(tag);
    this.u16(inner.length);
    const base = this.length;
    for (const p of inner.patches) this.patches.push({ at: base + p.at, image: p.image });
    for (const c of inner.chunks) this.bytes(c);
  }
  finish(imageOffsets: number[]): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    const view = new DataView(out.buffer);
    for (const p of this.patches) view.setUint32(p.at, imageOffsets[p.image], true);
    return out;
  }
}

function encodeWindows1252(s: string): Uint8Array {
  // Windows-1252 for the printable range; anything else becomes "?".
  const extra: Record<string, number> = {
    "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
    "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
    "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
  };
  return Uint8Array.from([...s], (c) => {
    const code = c.codePointAt(0)!;
    if (code === 0) return 0x3f;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
    return extra[c] ?? 0x3f;
  });
}

function writePalette(out: Out, palette: Rgb[]): void {
  out.u16(palette.length);
  for (const c of palette) {
    out.u8(c.r);
    out.u8(c.g);
    out.u8(c.b);
  }
}

function formatsFor(doc: AvbDocument, pose: AvbPose, out: Out): void {
  const pal = (i: number | null) => (i === null ? 0 : doc.images[i].paletteType);
  const fmt = (i: number | null) => (i === null ? 0 : 1);
  out.u8(fmt(pose.image));
  out.u8(fmt(pose.mask));
  out.u8(fmt(pose.aura));
  out.u8(pal(pose.image));
  out.u8(pal(pose.mask));
  out.u8(pal(pose.aura));
}

function writePoses(out: Out, doc: AvbDocument, tag: number, poses: AvbPose[], kind: "body" | "face" | "torso"): void {
  out.u16(tag);
  out.u16(poses.length);
  for (const pose of poses) {
    out.reference(pose.image);
    out.reference(pose.mask);
    out.reference(pose.aura);
    out.u16(pose.emotion);
    out.u8(Math.max(0, Math.min(255, Math.round(pose.intensity))));
    if (kind === "face") {
      const a = pose.anchor ?? { cx: 0, cy: 0, cxDelta: 0, cyDelta: 0 };
      out.i16(a.cx);
      out.i16(a.cy);
      out.i16(a.cxDelta);
      out.i16(a.cyDelta);
    }
    out.i16(pose.x);
    out.i16(pose.y);
    formatsFor(doc, pose, out);
  }
}

/** CAvatarFileZlibImage::Write */
async function writeImage(out: Out, image: AvbImage): Promise<void> {
  if (image.paletteType === AvbPalette.Local) {
    out.record(Tag.Palette, (o) => writePalette(o, image.palette ?? []));
  }
  const stride = dibStride(image.width, image.bitCount);
  const size = stride * Math.abs(image.height);
  if (image.bits.byteLength !== size) throw new Error("Image bits do not match its dimensions");
  const colors = image.bitCount <= 8 ? (image.clrUsed ?? 0) : 0;
  out.u32(40);
  out.i32(image.width);
  out.i32(image.height);
  out.u16(1);
  out.u16(image.bitCount);
  out.u32(0); // BI_RGB
  out.u32(size);
  out.i32(image.xPelsPerMeter ?? 0);
  out.i32(image.yPelsPerMeter ?? 0);
  out.u32(colors);
  out.u32(image.clrImportant ?? colors);
  const packed = await deflate(image.bits);
  out.u32(size);
  out.u32(packed.byteLength);
  out.bytes(packed);
}

/**
 * CAvatarX::Save / CChatBackdrop::Save. Records are written in the order the
 * shipped art uses; offsets are absolute, so the adjustment record is 0.
 */
export async function writeAvbDocument(doc: AvbDocument): Promise<Uint8Array> {
  validateDocument(doc);
  const out = new Out();
  out.u16(AVB_MAGIC);
  out.u16(doc.type);
  out.u16(doc.version || AVB_VERSION);
  out.record(Tag.OffsetAdjustment, (o) => o.i32(0));
  if (doc.type !== AvbType.Backdrop) {
    out.u16(Tag.Name);
    out.cString(doc.name ?? "");
    out.u16(Tag.Style);
    out.u16(doc.style ?? 0);
    out.u16(Tag.Flags);
    out.u16(doc.flags ?? 0);
  }
  if (doc.copyright) out.record(Tag.Copyright, (o) => o.cString(doc.copyright!));
  if (doc.originalUrl) out.record(Tag.OriginalUrl, (o) => o.cString(doc.originalUrl!));
  if (doc.overrideUrl) out.record(Tag.OverrideUrl, (o) => o.cString(doc.overrideUrl!));
  if (doc.usageFlags) out.record(Tag.UsageFlags, (o) => o.u8(doc.usageFlags!));
  if (doc.globalPalette?.length) out.record(Tag.Palette, (o) => writePalette(o, doc.globalPalette!));
  for (const unknown of doc.unknownRecords ?? []) out.record(unknown.tag, (o) => o.bytes(unknown.payload));
  if (doc.type === AvbType.Backdrop) {
    out.record(Tag.Backdrop, (o) => {
      o.reference(doc.backdrop);
      o.u8(1);
      o.u8(doc.backdrop != null ? doc.images[doc.backdrop].paletteType : 0);
    });
  } else {
    if (doc.icon != null) {
      out.record(Tag.Icon, (o) => {
        o.reference(doc.icon);
        o.u8(1);
        o.u8(doc.images[doc.icon!].paletteType);
      });
    }
    if (doc.type === AvbType.Simple) writePoses(out, doc, Tag.Bodies, doc.bodies, "body");
    else {
      writePoses(out, doc, Tag.Faces, doc.faces, "face");
      writePoses(out, doc, Tag.Torsos, doc.torsos, "torso");
    }
  }
  out.u16(Tag.StartData);
  const offsets: number[] = [];
  for (const image of doc.images) {
    offsets.push(out.length);
    await writeImage(out, image);
  }
  out.u16(Tag.EndData);
  return out.finish(offsets);
}

/** Structural checks shared by the writer and the upload path. */
export function validateDocument(doc: AvbDocument): void {
  const count = doc.images.length;
  if (count > MAX_IMAGES) throw new Error("Too many images");
  const check = (i: number | null | undefined, what: string) => {
    if (i !== null && i !== undefined && (!Number.isInteger(i) || i < 0 || i >= count)) {
      throw new Error(`${what} refers to a missing image`);
    }
  };
  check(doc.icon, "Icon");
  check(doc.backdrop, "Backdrop");
  for (const [list, name] of [
    [doc.bodies, "Body"],
    [doc.faces, "Face"],
    [doc.torsos, "Torso"],
  ] as const) {
    if (list.length > 512) throw new Error(`Too many ${name.toLowerCase()} poses`);
    list.forEach((pose, i) => {
      check(pose.image, `${name} ${i + 1}`);
      check(pose.mask, `${name} ${i + 1} mask`);
      check(pose.aura, `${name} ${i + 1} aura`);
    });
  }
  if (doc.type === AvbType.Simple && doc.bodies.length === 0) throw new Error("A character needs at least one pose");
  if (doc.type === AvbType.Complex && (doc.faces.length === 0 || doc.torsos.length === 0)) {
    throw new Error("A head-and-torso character needs at least one face and one torso");
  }
  if (doc.type === AvbType.Backdrop && doc.backdrop == null) throw new Error("A backdrop needs an image");
  for (const image of doc.images) {
    if (image.width <= 0 || image.width > MAX_DIMENSION || image.height === 0 || Math.abs(image.height) > MAX_DIMENSION) {
      throw new Error(`Image dimensions out of range: ${image.width}×${image.height}`);
    }
    if (image.paletteType === AvbPalette.Local && (!image.palette || image.palette.length > 256)) {
      throw new Error("Local-palette image needs a palette of at most 256 colours");
    }
  }
}
