const MAGIC = 0x8181;
const TAG_START_DATA = 6;
const TAG_NAME = 1;
const TAG_FLAGS = 2;
const TAG_STYLE = 8;
const TAG_FACES = 10;
const TAG_TORSOS = 11;
const TAG_BODIES = 12;
const TAG_ICON = 256;
const TAG_PALETTE = 257;
const TAG_BACKDROP = 258;
const TAG_COPYRIGHT = 259;
const TAG_OFFSET_ADJUSTMENT = 263;

export const enum AvatarType {
  Simple = 1,
  Complex = 2,
  Backdrop = 3,
}

export const enum PaletteType {
  None = 0,
  Global = 1,
  Local = 2,
  Monochrome = 3,
  MaskedMonochrome = 4,
  DualMask = 5,
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ImageDescriptor {
  offset: number;
  format: number;
  paletteType: PaletteType;
}

export interface PoseDescriptor {
  image: ImageDescriptor;
  mask: ImageDescriptor;
  aura: ImageDescriptor;
  emotion: number;
  intensity: number;
  x: number;
  y: number;
}

export interface AvatarFile {
  type: AvatarType;
  version: number;
  name: string;
  copyright: string;
  flags: number;
  style: number;
  icon?: ImageDescriptor;
  backdrop?: ImageDescriptor;
  bodies: PoseDescriptor[];
  faces: PoseDescriptor[];
  torsos: PoseDescriptor[];
  palette: Rgb[];
}

export interface DecodedBitmap {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

class Reader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  ensure(length: number): void {
    if (this.offset + length > this.view.byteLength) {
      throw new Error("Unexpected end of Comic Chat asset");
    }
  }

  u8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  i32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.ensure(length);
    const value = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return value;
  }

  cString(maxLength = 1024): string {
    const start = this.offset;
    let length = 0;
    while (length < maxLength && this.offset < this.view.byteLength) {
      if (this.u8() === 0) {
        return new TextDecoder("windows-1252").decode(
          new Uint8Array(this.buffer, start, length),
        );
      }
      length += 1;
    }
    throw new Error("Unterminated string in Comic Chat asset");
  }
}

function adjustedOffset(offset: number, adjustment: number): number {
  return offset === 0 ? 0 : offset + adjustment;
}

function readImageDescriptor(reader: Reader, adjustment: number): ImageDescriptor {
  return {
    offset: adjustedOffset(reader.u32(), adjustment),
    format: reader.u8(),
    paletteType: reader.u8() as PaletteType,
  };
}

function emptyDescriptor(): ImageDescriptor {
  return { offset: 0, format: 0, paletteType: PaletteType.None };
}

function readPalette(reader: Reader): Rgb[] {
  const count = reader.u16();
  if (count > 2048) {
    throw new Error(`Invalid Comic Chat palette size: ${count}`);
  }
  const colors: Rgb[] = [];
  for (let index = 0; index < count; index += 1) {
    colors.push({ r: reader.u8(), g: reader.u8(), b: reader.u8() });
  }
  return colors;
}

function readPose(reader: Reader, adjustment: number, kind: "body" | "face" | "torso"): PoseDescriptor {
  const imageOffset = reader.u32();
  const maskOffset = reader.u32();
  const auraOffset = reader.u32();
  const emotion = reader.u16();
  const intensity = reader.u8();

  let x = 0;
  let y = 0;
  if (kind === "face") {
    reader.u16(); // center x
    reader.u16(); // center y
    reader.u16(); // center delta x
    reader.u16(); // center delta y
    x = reader.u16();
    y = reader.u16();
  } else if (kind === "torso") {
    x = reader.u16();
    y = reader.u16();
  } else {
    x = reader.u16();
    y = reader.u16();
  }

  const imageFormat = reader.u8();
  const maskFormat = reader.u8();
  const auraFormat = reader.u8();
  const imagePalette = reader.u8() as PaletteType;
  const maskPalette = reader.u8() as PaletteType;
  const auraPalette = reader.u8() as PaletteType;

  return {
    image: {
      offset: adjustedOffset(imageOffset, adjustment),
      format: imageFormat,
      paletteType: imagePalette,
    },
    mask: {
      offset: adjustedOffset(maskOffset, adjustment),
      format: maskFormat,
      paletteType: maskPalette,
    },
    aura: {
      offset: adjustedOffset(auraOffset, adjustment),
      format: auraFormat,
      paletteType: auraPalette,
    },
    emotion,
    intensity,
    x,
    y,
  };
}

function readPoseList(
  reader: Reader,
  adjustment: number,
  kind: "body" | "face" | "torso",
): PoseDescriptor[] {
  const count = reader.u16();
  if (count > 512) {
    throw new Error(`Invalid Comic Chat pose count: ${count}`);
  }
  return Array.from({ length: count }, () => readPose(reader, adjustment, kind));
}

export function parseAvatar(buffer: ArrayBuffer): AvatarFile {
  const reader = new Reader(buffer);
  const magic = reader.u16();
  if (magic !== MAGIC) {
    throw new Error("This is not a version 2 Comic Chat art file");
  }

  const type = reader.u16() as AvatarType;
  const version = reader.u16();
  let name = "";
  let copyright = "";
  let flags = 0;
  let style = 0;
  let adjustment = 0;
  let icon: ImageDescriptor | undefined;
  let backdrop: ImageDescriptor | undefined;
  let bodies: PoseDescriptor[] = [];
  let faces: PoseDescriptor[] = [];
  let torsos: PoseDescriptor[] = [];
  let palette: Rgb[] = [];

  while (reader.offset < buffer.byteLength) {
    const tag = reader.u16();
    if (tag === TAG_START_DATA) break;

    const isSized = tag >= TAG_ICON;
    const size = isSized ? reader.u16() : 0;
    const payloadStart = reader.offset;

    switch (tag) {
      case TAG_NAME:
        name = reader.cString(60);
        break;
      case TAG_FLAGS:
        flags = reader.u16();
        break;
      case TAG_STYLE:
        style = reader.u16();
        break;
      case TAG_ICON:
        icon = readImageDescriptor(reader, adjustment);
        break;
      case TAG_BACKDROP:
        backdrop = readImageDescriptor(reader, adjustment);
        break;
      case TAG_COPYRIGHT:
        copyright = reader.cString(256);
        break;
      case TAG_OFFSET_ADJUSTMENT:
        adjustment += reader.i32();
        break;
      case TAG_PALETTE:
        palette = readPalette(reader);
        break;
      case TAG_BODIES:
        bodies = readPoseList(reader, adjustment, "body");
        break;
      case TAG_FACES:
        faces = readPoseList(reader, adjustment, "face");
        break;
      case TAG_TORSOS:
        torsos = readPoseList(reader, adjustment, "torso");
        break;
      default:
        if (!isSized) {
          throw new Error(`Unsupported legacy Comic Chat record: ${tag}`);
        }
    }

    if (isSized) {
      reader.offset = payloadStart + size;
    }
  }

  return { type, version, name, copyright, flags, style, icon, backdrop, bodies, faces, torsos, palette };
}

function paletteFor(type: PaletteType, globalPalette: Rgb[], reader: Reader): Rgb[] {
  switch (type) {
    case PaletteType.Global:
      return globalPalette;
    case PaletteType.Local: {
      const tag = reader.u16();
      reader.u16(); // sized-record payload length
      if (tag !== TAG_PALETTE) throw new Error("Missing local palette record");
      return readPalette(reader);
    }
    case PaletteType.Monochrome:
      return [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }];
    case PaletteType.MaskedMonochrome:
    case PaletteType.DualMask:
      return [
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0 },
        { r: 128, g: 0, b: 0 },
        { r: 0, g: 0, b: 128 },
      ];
    default:
      return [];
  }
}

function pixelIndex(data: Uint8Array, rowStart: number, x: number, bitCount: number): number {
  switch (bitCount) {
    case 1:
      return (data[rowStart + (x >> 3)] >> (7 - (x & 7))) & 1;
    case 2:
      return (data[rowStart + (x >> 2)] >> (6 - ((x & 3) << 1))) & 3;
    case 4:
      return (data[rowStart + (x >> 1)] >> (x % 2 === 0 ? 4 : 0)) & 15;
    case 8:
      return data[rowStart + x];
    default:
      return -1;
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(data);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeImage(
  buffer: ArrayBuffer,
  descriptor: ImageDescriptor,
  globalPalette: Rgb[] = [],
): Promise<DecodedBitmap> {
  if (!descriptor.offset) throw new Error("Image descriptor has no data offset");
  if (descriptor.format !== 1) throw new Error(`Unsupported Comic Chat image format: ${descriptor.format}`);

  const reader = new Reader(buffer);
  reader.offset = descriptor.offset;
  const palette = paletteFor(descriptor.paletteType, globalPalette, reader);
  const headerSize = reader.u32();
  if (headerSize < 40 || headerSize > 240) throw new Error(`Invalid DIB header size: ${headerSize}`);

  const width = reader.i32();
  const signedHeight = reader.i32();
  const planes = reader.u16();
  const bitCount = reader.u16();
  const compression = reader.u32();
  reader.u32(); // declared image size
  reader.i32(); // horizontal resolution
  reader.i32(); // vertical resolution
  reader.u32(); // colors used
  reader.u32(); // important colors
  if (headerSize > 40) reader.bytes(headerSize - 40);

  if (planes !== 1 || compression !== 0 || width <= 0 || signedHeight === 0) {
    throw new Error("Unsupported DIB layout in Comic Chat asset");
  }

  const uncompressedSize = reader.u32();
  const compressedSize = reader.u32();
  const bitmapData = await inflate(reader.bytes(compressedSize));
  if (bitmapData.byteLength !== uncompressedSize) {
    throw new Error("Comic Chat bitmap decompressed to an unexpected size");
  }

  const height = Math.abs(signedHeight);
  const stride = Math.ceil((width * bitCount) / 32) * 4;
  if (stride * height !== bitmapData.byteLength) {
    throw new Error("Comic Chat bitmap dimensions do not match its data");
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  const isMaskedMono = descriptor.paletteType === PaletteType.MaskedMonochrome;
  const isBottomUp = signedHeight > 0;

  for (let y = 0; y < height; y += 1) {
    const sourceY = isBottomUp ? height - 1 - y : y;
    const rowStart = sourceY * stride;
    for (let x = 0; x < width; x += 1) {
      const output = (y * width + x) * 4;
      if (bitCount <= 8) {
        const index = pixelIndex(bitmapData, rowStart, x, bitCount);
        if (isMaskedMono) {
          // 00 = empty, 01 = aura, 10 = black, 11 = white in the original format.
          const value = index === 3 ? 255 : 0;
          pixels[output] = value;
          pixels[output + 1] = value;
          pixels[output + 2] = value;
          pixels[output + 3] = index >= 2 ? 255 : index === 1 ? 70 : 0;
        } else {
          const color = palette[index] ?? { r: 255, g: 0, b: 255 };
          pixels[output] = color.r;
          pixels[output + 1] = color.g;
          pixels[output + 2] = color.b;
          pixels[output + 3] = 255;
        }
      } else if (bitCount === 24 || bitCount === 32) {
        const bytesPerPixel = bitCount / 8;
        const source = rowStart + x * bytesPerPixel;
        pixels[output] = bitmapData[source + 2];
        pixels[output + 1] = bitmapData[source + 1];
        pixels[output + 2] = bitmapData[source];
        pixels[output + 3] = bitCount === 32 ? bitmapData[source + 3] : 255;
      } else {
        throw new Error(`Unsupported Comic Chat color depth: ${bitCount}`);
      }
    }
  }

  return { width, height, pixels };
}

export function noImage(): ImageDescriptor {
  return emptyDescriptor();
}
