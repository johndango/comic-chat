import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AvatarType, parseAvatar } from "./avb";
import { bodyForEmotion, placeHeadOnTorso } from "./composite";
import { analyzeMessage } from "./emotion";

const artDirectory = new URL("../../v2.5-beta-1-modern/comicart/", import.meta.url);

function load(file: string): ArrayBuffer {
  const bytes = readFileSync(new URL(file, artDirectory));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const complexFiles = readdirSync(artDirectory)
  .filter((file) => file.endsWith(".avb"))
  .filter((file) => parseAvatar(load(file)).type !== AvatarType.Simple);

describe("placeHeadOnTorso", () => {
  it("lands the head anchor on the torso neck", () => {
    const face = { x: 50, y: 40, anchor: { cx: 40, cy: 90, cxDelta: -4, cyDelta: 3 } } as never;
    const torso = { x: 90, y: 20 } as never;
    const place = placeHeadOnTorso(face, torso, { width: 100, height: 100 }, { width: 200, height: 300 });
    // Head origin relative to torso: (90 - 4 - 40, 20 + 3 - 90) = (46, -67)
    expect(place.torso).toEqual({ x: 0, y: 67 });
    expect(place.head).toEqual({ x: 46, y: 0 });
    expect(place.width).toBe(200);
    expect(place.height).toBe(367);
    expect(place.faceX).toBe(96);
    expect(place.headHeight).toBe(100);
  });
});

describe("colour avatars with dual masks", () => {
  it("makes Kirby's white background transparent but keeps his figure", async () => {
    const buffer = load("kirby.avb");
    const avatar = parseAvatar(buffer);
    const body = await bodyForEmotion(buffer, avatar, analyzeMessage(""));
    const alpha = (x: number, y: number) => body.bitmap.pixels[(y * body.bitmap.width + x) * 4 + 3];
    expect(alpha(0, body.bitmap.height - 1)).toBe(0); // a corner is background
    let opaque = 0;
    for (let i = 3; i < body.bitmap.pixels.length; i += 4) if (body.bitmap.pixels[i] === 255) opaque += 1;
    const fraction = opaque / (body.bitmap.width * body.bitmap.height);
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.85);
  });
});

describe("head + torso avatars", () => {
  it("covers every bundled complex character", () => {
    expect(complexFiles.length).toBe(18);
  });

  it.each(complexFiles)("%s composes into one upright figure", async (file) => {
    const buffer = load(file);
    const avatar = parseAvatar(buffer);
    for (const text of ["", "HELLO!!!", "that's sad :("]) {
      const body = await bodyForEmotion(buffer, avatar, analyzeMessage(text));
      expect(body.bitmap.width).toBeGreaterThan(0);
      expect(body.bitmap.height).toBeGreaterThan(body.bitmap.width * 0.8); // a standing figure
      expect(body.faceX).toBeGreaterThan(0);
      expect(body.faceX).toBeLessThan(body.bitmap.width);
      expect(body.headHeight).toBeLessThan(body.bitmap.height * 0.75);
      // Something opaque exists in the head band and the lower half.
      const opaqueRows = (from: number, to: number) => {
        let count = 0;
        for (let y = from; y < to; y += 1) {
          for (let x = 0; x < body.bitmap.width; x += 1) {
            if (body.bitmap.pixels[(y * body.bitmap.width + x) * 4 + 3] > 0) {
              count += 1;
              break;
            }
          }
        }
        return count;
      };
      expect(opaqueRows(0, body.headHeight)).toBeGreaterThan(0);
      expect(opaqueRows(Math.trunc(body.bitmap.height / 2), body.bitmap.height)).toBeGreaterThan(0);
    }
  });
});
