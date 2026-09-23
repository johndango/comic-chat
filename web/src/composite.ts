// Head + torso ("complex") avatars, ported from CBodyDouble in avatar.cpp and
// bodycam.cpp. 18 of the 25 bundled characters (Anna, Dan, Kirby, ...) are
// stored this way: a set of faces and a set of torsos, chosen independently
// and joined at the neck.

import {
  AvatarType,
  decodeImage,
  PaletteType,
  type AvatarFile,
  type DecodedBitmap,
  type PoseDescriptor,
} from "./avb";
import type { EmotionResult } from "./emotion";
import { selectPose } from "./emotion";
import { choosePoses, emotionOptions, type ExpressionOptions, type PoseChoice, type PoseMemory } from "./expression";

// avatar.h flags
const TORSOFIRST = 4;

export interface ComposedBody {
  bitmap: DecodedBitmap;
  /** Face position from the bitmap's left edge (unflipped) — where tails aim. */
  faceX: number;
  /** Bottom of the head from the top of the bitmap (GetDimInfo headHeight). */
  headHeight: number;
  /** Stable identifier for caching, e.g. "f3:t7" or "b2". */
  key: string;
}

export interface Placement {
  width: number;
  height: number;
  head: { x: number; y: number };
  torso: { x: number; y: number };
  faceX: number;
  headHeight: number;
}

/**
 * CBodyDouble::GetBodyBox / GetDimInfo: place the head so that its anchor
 * (cx, cy) lands on the torso's neck (x, y) shifted by (cxDelta, cyDelta).
 */
export function placeHeadOnTorso(
  face: PoseDescriptor,
  torso: PoseDescriptor,
  headSize: { width: number; height: number },
  torsoSize: { width: number; height: number },
): Placement {
  const anchor = face.anchor ?? { cx: 0, cy: 0, cxDelta: 0, cyDelta: 0 };
  const xOffset = torso.x + anchor.cxDelta - anchor.cx;
  const yOffset = torso.y + anchor.cyDelta - anchor.cy;
  const left = Math.min(0, xOffset);
  const top = Math.min(0, yOffset);
  const right = Math.max(torsoSize.width, xOffset + headSize.width);
  const bottom = Math.max(torsoSize.height, yOffset + headSize.height);
  return {
    width: right - left,
    height: bottom - top,
    head: { x: xOffset - left, y: yOffset - top },
    torso: { x: Math.max(0, -left), y: Math.max(0, -top) },
    faceX: face.x + xOffset - left,
    headHeight: yOffset + headSize.height - top,
  };
}

/** Source-over composite of `src` onto `dst` at (x, y). */
function blit(dst: DecodedBitmap, src: DecodedBitmap, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy += 1) {
    const dy = sy + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx += 1) {
      const dx = sx + x;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (sy * src.width + sx) * 4;
      const d = (dy * dst.width + dx) * 4;
      const a = src.pixels[s + 3] / 255;
      if (a === 0) continue;
      const da = dst.pixels[d + 3] / 255;
      const outA = a + da * (1 - a);
      for (let c = 0; c < 3; c += 1) {
        dst.pixels[d + c] = Math.round((src.pixels[s + c] * a + dst.pixels[d + c] * da * (1 - a)) / outA);
      }
      dst.pixels[d + 3] = Math.round(outA * 255);
    }
  }
}

/** Join a decoded head and torso into one bitmap (CBodyDouble::DrawBody order). */
export function composeHeadAndTorso(
  avatar: AvatarFile,
  face: PoseDescriptor,
  torso: PoseDescriptor,
  head: DecodedBitmap,
  body: DecodedBitmap,
): Omit<ComposedBody, "key"> {
  const place = placeHeadOnTorso(face, torso, head, body);
  const bitmap: DecodedBitmap = {
    width: place.width,
    height: place.height,
    pixels: new Uint8ClampedArray(place.width * place.height * 4),
  };
  if (avatar.flags & TORSOFIRST) {
    blit(bitmap, body, place.torso.x, place.torso.y);
    blit(bitmap, head, place.head.x, place.head.y);
  } else {
    blit(bitmap, head, place.head.x, place.head.y);
    blit(bitmap, body, place.torso.x, place.torso.y);
  }
  return { bitmap, faceX: place.faceX, headHeight: place.headHeight };
}

/**
 * Apply a pose's separate mask to a colour image (CPose::ConvertFromDualMask).
 * Each 2-bit mask pixel holds two masks: bit 0 is the figure mask (painted
 * white under the art with MERGEPAINT) and bit 1 the aura (a white halo).
 * The art itself is drawn with SRCAND, so white art pixels outside both masks
 * are see-through. The web decoder renders mask pixels through the 4-colour
 * masked palette, which this maps back to indices.
 */
export function applyDualMask(image: DecodedBitmap, mask: DecodedBitmap): DecodedBitmap {
  const out = new Uint8ClampedArray(image.pixels);
  const width = Math.min(image.width, mask.width);
  const height = Math.min(image.height, mask.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      let index = 0;
      if (x < width && y < height) {
        const m = (y * mask.width + x) * 4;
        const [r, g, b] = [mask.pixels[m], mask.pixels[m + 1], mask.pixels[m + 2]];
        index = r === 255 && g === 255 ? 0 : r === 0 && b === 0 ? 1 : r === 128 ? 2 : 3;
      }
      const figure = (index & 1) !== 0;
      const aura = (index & 2) !== 0;
      const white = out[i] > 250 && out[i + 1] > 250 && out[i + 2] > 250;
      if (white && !figure) {
        if (aura) out[i + 3] = 255;
        else out[i + 3] = 0;
      }
    }
  }
  return { width: image.width, height: image.height, pixels: out };
}

/** Decode a pose's art, applying its dual mask when it has one. */
export async function decodePose(
  buffer: ArrayBuffer,
  pose: PoseDescriptor,
  avatar: AvatarFile,
  decode: typeof decodeImage = decodeImage,
): Promise<DecodedBitmap> {
  const image = await decode(buffer, pose.image, avatar.palette);
  if (pose.image.paletteType === PaletteType.MaskedMonochrome) return image;
  if (!pose.mask.offset || pose.mask.paletteType !== PaletteType.DualMask) return image;
  return applyDualMask(image, await decode(buffer, pose.mask, avatar.palette));
}

/**
 * Pick and decode a pose for either kind of avatar. For head+torso avatars the
 * face and torso are chosen independently from the same emotion, as
 * CAvatarComplex::GetBodyFromEmotion does.
 */
export async function bodyForEmotion(
  buffer: ArrayBuffer,
  avatar: AvatarFile,
  emotion: EmotionResult,
  decode: typeof decodeImage = decodeImage,
): Promise<ComposedBody> {
  if (avatar.type === AvatarType.Simple || avatar.faces.length === 0 || avatar.torsos.length === 0) {
    const index = selectPose(avatar.bodies, emotion);
    const pose = avatar.bodies[index];
    const bitmap = await decodePose(buffer, pose, avatar, decode);
    return { bitmap, faceX: pose.x, headHeight: Math.trunc(bitmap.height / 2), key: `b${index}` };
  }
  const faceIndex = selectPose(avatar.faces, emotion);
  const torsoIndex = selectPose(avatar.torsos, emotion);
  const face = avatar.faces[faceIndex];
  const torso = avatar.torsos[torsoIndex];
  const [head, body] = await Promise.all([
    decodePose(buffer, face, avatar, decode),
    decodePose(buffer, torso, avatar, decode),
  ]);
  return { ...composeHeadAndTorso(avatar, face, torso, head, body), key: `f${faceIndex}:t${torsoIndex}` };
}

/** Decode and assemble the poses picked by choosePoses(). */
export async function composeChoice(
  buffer: ArrayBuffer,
  avatar: AvatarFile,
  choice: PoseChoice,
  decode: typeof decodeImage = decodeImage,
): Promise<ComposedBody> {
  if (choice.kind === "simple") {
    const pose = avatar.bodies[choice.body];
    const bitmap = await decodePose(buffer, pose, avatar, decode);
    return { bitmap, faceX: pose.x, headHeight: Math.trunc(bitmap.height / 2), key: `b${choice.body}` };
  }
  const face = avatar.faces[choice.face];
  const torso = avatar.torsos[choice.torso];
  const [head, body] = await Promise.all([decodePose(buffer, face, avatar, decode), decodePose(buffer, torso, avatar, decode)]);
  return { ...composeHeadAndTorso(avatar, face, torso, head, body), key: `f${choice.face}:t${choice.torso}` };
}

/**
 * The faithful 2.5 pipeline: every matching rule contributes, the face and
 * torso are chosen separately, and neutral poses rotate via `memory`.
 */
export async function bodyForText(
  buffer: ArrayBuffer,
  avatar: AvatarFile,
  text: string,
  memory?: PoseMemory,
  settings?: ExpressionOptions,
  decode: typeof decodeImage = decodeImage,
): Promise<ComposedBody> {
  return composeChoice(buffer, avatar, choosePoses(avatar, emotionOptions(text, settings), memory), decode);
}
