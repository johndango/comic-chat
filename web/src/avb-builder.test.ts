import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AvatarType, decodeImage, parseAvatar } from "./avb";
import { createBackdrop, createHeadAndTorsoCharacter, createSimpleCharacter, Emotion, encodeMono, type Rgba } from "./avb-builder";
import { readAvbDocument, writeAvbDocument } from "./avb-document";
import { bodyForText, decodePose } from "./composite";

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A test figure: transparent background, a black-outlined disc filled with a colour. */
function figure(width: number, height: number, fill: [number, number, number] = [255, 255, 255]): Rgba {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 6;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const i = (y * width + x) * 4;
      if (d > r) continue;
      const ink = d > r - 3;
      pixels.set(ink ? [0, 0, 0, 255] : [...fill, 255], i);
    }
  }
  return { width, height, pixels };
}

const at = (px: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(px.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

describe("encodeMono", () => {
  it("encodes ink, fill, aura and blank the way the original art does", async () => {
    const art = figure(60, 80);
    const doc = createSimpleCharacter({ name: "Disc" }, [{ art, emotion: Emotion.Neutral, intensity: 0 }]);
    const bytes = await writeAvbDocument(doc);
    const avatar = parseAvatar(buffer(bytes));
    expect(avatar.type).toBe(AvatarType.Simple);
    const decoded = await decodeImage(buffer(bytes), avatar.bodies[0].image, avatar.palette);
    expect([decoded.width, decoded.height]).toEqual([60, 80]);
    expect(at(decoded.pixels, 60, 30, 40)).toEqual([255, 255, 255, 255]); // fill
    const edge = 30 - (Math.min(60, 80) / 2 - 6) + 1; // inside the outline
    expect(at(decoded.pixels, 60, Math.round(edge), 40)[0]).toBe(0); // ink
    expect(at(decoded.pixels, 60, 0, 0)[3]).toBe(0); // blank corner
    // The aura sits just outside the figure.
    const outside = Math.round(30 - (Math.min(60, 80) / 2 - 6)) - 2;
    expect(at(decoded.pixels, 60, outside, 40)[3]).toBeGreaterThan(0);
  });

  it("re-encodes a shipped character's figure exactly", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../../v2.5-beta-1-modern/comicart/tux.avb", import.meta.url)));
    const tux = parseAvatar(buffer(bytes));
    const original = await decodeImage(buffer(bytes), tux.bodies[0].image, tux.palette);
    // Keep only the figure (opaque black/white); drop the translucent aura.
    const art: Rgba = { ...original, pixels: Uint8ClampedArray.from(original.pixels, (v, i) => (i % 4 === 3 && v < 255 ? 0 : v)) };
    const doc = createSimpleCharacter({ name: "Tux copy" }, [{ art, emotion: Emotion.Neutral, intensity: 0 }]);
    const written = await writeAvbDocument(doc);
    const copy = parseAvatar(buffer(written));
    const decoded = await decodeImage(buffer(written), copy.bodies[0].image, copy.palette);
    let mismatches = 0;
    for (let i = 0; i < original.pixels.length; i += 4) {
      if (original.pixels[i + 3] !== 255) continue; // figure pixels only
      if (decoded.pixels[i] !== original.pixels[i] || decoded.pixels[i + 3] !== 255) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});

describe("colour characters", () => {
  it("keeps colours inside the figure and makes the background see-through", async () => {
    const art = figure(50, 50, [200, 40, 40]);
    const doc = createSimpleCharacter({ name: "Red", style: "color" }, [{ art, emotion: Emotion.Neutral, intensity: 0 }]);
    const bytes = await writeAvbDocument(doc);
    const avatar = parseAvatar(buffer(bytes));
    const pose = await decodePose(buffer(bytes), avatar.bodies[0], avatar);
    expect(at(pose.pixels, 50, 25, 25)).toEqual([200, 40, 40, 255]);
    expect(at(pose.pixels, 50, 0, 0)[3]).toBe(0);
  });
});

describe("assembled characters", () => {
  it("writes a 40×40 icon, the download URL and a credit", async () => {
    const doc = createSimpleCharacter(
      { name: "Disc", copyright: "© 2026 Test Artist · CC BY 4.0", url: "https://webcomicchat.com/art/disc.avb" },
      [{ art: figure(60, 80), emotion: Emotion.Neutral, intensity: 0 }],
    );
    const again = await readAvbDocument(await writeAvbDocument(doc));
    expect(again.originalUrl).toBe("https://webcomicchat.com/art/disc.avb");
    expect(again.copyright).toBe("© 2026 Test Artist · CC BY 4.0");
    const icon = again.images[again.icon!];
    expect([icon.width, icon.height]).toEqual([40, 40]);
  });

  it("picks the right pose for a line of chat", async () => {
    const neutral = figure(60, 90);
    const happy = figure(60, 90, [255, 255, 0]);
    const doc = createSimpleCharacter({ name: "Moody", style: "color" }, [
      { art: neutral, emotion: Emotion.Neutral, intensity: 0 },
      { art: happy, emotion: Emotion.Happy, intensity: 1 },
    ]);
    const bytes = await writeAvbDocument(doc);
    const avatar = parseAvatar(buffer(bytes));
    const body = await bodyForText(buffer(bytes), avatar, "great news :)");
    expect(at(body.bitmap.pixels, body.bitmap.width, 30, 45)).toEqual([255, 255, 0, 255]);
  });

  it("joins a head to a torso at the neck", async () => {
    const head = figure(40, 40);
    const torso = figure(60, 100);
    const doc = createHeadAndTorsoCharacter(
      { name: "Stack" },
      [{ art: head, emotion: Emotion.Neutral, intensity: 0, neck: { x: 20, y: 38 } }],
      [{ art: torso, emotion: Emotion.Neutral, intensity: 0, neck: { x: 30, y: 4 } }],
    );
    const bytes = await writeAvbDocument(doc);
    const avatar = parseAvatar(buffer(bytes));
    expect(avatar.type).toBe(AvatarType.Complex);
    expect(avatar.flags).toBe(5);
    const body = await bodyForText(buffer(bytes), avatar, "");
    // Head (40 tall) sits above the torso: 38 - 4 = 34 px of head show above it.
    expect(body.bitmap.height).toBe(100 + 34);
    expect(body.bitmap.width).toBe(60);
  });

  it("makes a backdrop", async () => {
    const art = figure(120, 80, [30, 90, 200]);
    const bytes = await writeAvbDocument(createBackdrop({ copyright: "© 2026 Test" }, art));
    const parsed = parseAvatar(buffer(bytes));
    expect(parsed.type).toBe(AvatarType.Backdrop);
    const image = await decodeImage(buffer(bytes), parsed.backdrop!, parsed.palette);
    expect(at(image.pixels, 120, 60, 40)).toEqual([30, 90, 200, 255]);
  });
});

describe("encodeMono options", () => {
  it("can skip the aura", () => {
    const image = encodeMono(figure(30, 30), { aura: 0 });
    // No 01 (aura) pairs anywhere.
    for (const byte of image.bits) for (let s = 0; s < 8; s += 2) expect((byte >> s) & 3).not.toBe(1);
  });
});
