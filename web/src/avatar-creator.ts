import { createSimpleCharacter, type ArtStyle, type Rgba } from "./avb-builder";
import { writeAvbDocument } from "./avb-document";

export const BUILDER_EMOTIONS = [
  [9, "Neutral"],
  [1, "Happy"],
  [2, "Coy"],
  [3, "Bored"],
  [4, "Scared"],
  [5, "Sad"],
  [6, "Angry"],
  [7, "Shout"],
  [8, "Laugh"],
  [10, "Wave"],
  [11, "Point at other"],
  [12, "Point at self"],
  [13, "Double point"],
  [14, "Shrug"],
] as const;

export interface CreatorPose {
  art: Rgba;
  emotion: number;
  intensity: number;
}

export interface CreatorOptions {
  name: string;
  credit?: string;
  style: ArtStyle;
  aura: number;
  poses: CreatorPose[];
}

const MAX_POSES = 16;
const MAX_DIMENSION = 512;
const MAX_SOURCE_DIMENSION = 2048;

export function creatorImageSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Pose images must have valid dimensions");
  }
  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
    throw new Error(`Source images must be ${MAX_SOURCE_DIMENSION}×${MAX_SOURCE_DIMENSION} pixels or smaller`);
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function cleanText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, maximum);
}

export function avatarDownloadName(name: string): string {
  const stem = cleanText(name, 60)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase();
  return `${stem || "comic-chat-avatar"}.avb`;
}

export function validateCreatorArt(art: Rgba): void {
  if (!Number.isInteger(art.width) || !Number.isInteger(art.height) || art.width < 1 || art.height < 1) {
    throw new Error("Pose images must have valid dimensions");
  }
  if (art.width > MAX_DIMENSION || art.height > MAX_DIMENSION) {
    throw new Error("Pose images must be 512×512 pixels or smaller");
  }
  if (art.pixels.byteLength !== art.width * art.height * 4) throw new Error("A pose image has incomplete pixel data");
}

export async function buildSimpleAvatar(options: CreatorOptions): Promise<ArrayBuffer> {
  const name = cleanText(options.name, 60);
  if (!name) throw new Error("Enter a character name");
  if (options.poses.length === 0) throw new Error("Add at least one pose image");
  if (options.poses.length > MAX_POSES) throw new Error(`A character can have at most ${MAX_POSES} poses`);
  for (const pose of options.poses) validateCreatorArt(pose.art);
  const document = createSimpleCharacter({
    name,
    style: options.style,
    encode: { aura: Math.max(0, Math.min(8, Math.round(options.aura))) },
    ...(cleanText(options.credit ?? "", 240) ? { copyright: cleanText(options.credit ?? "", 240) } : {}),
  }, options.poses);
  const bytes = await writeAvbDocument(document);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function imageFileToRgba(file: File): Promise<Rgba> {
  if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} is larger than 4 MB`);
  const bitmap = await createImageBitmap(file);
  try {
    let size: { width: number; height: number };
    try {
      size = creatorImageSize(bitmap.width, bitmap.height);
    } catch (error) {
      throw new Error(`${file.name}: ${error instanceof Error ? error.message : "unsupported image size"}`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas image decoding is unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height).data;
    return { width: size.width, height: size.height, pixels };
  } finally {
    bitmap.close();
  }
}
