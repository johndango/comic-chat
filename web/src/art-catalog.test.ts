import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AvatarType, decodeImage, parseAvatar } from "./avb";
import { bodyForText } from "./composite";
import { newPoseMemory } from "./expression";

const artDirectories = [
  new URL("../../v2.5-beta-1-modern/comicart/", import.meta.url),
  new URL("../../v2.5-beta-1-modern/artpack1/", import.meta.url),
  new URL("../../colorreplace21/", import.meta.url),
];

async function bufferFor(url: URL): Promise<ArrayBuffer> {
  const bytes = await readFile(url);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("complete bundled Comic Chat art catalog", () => {
  it("parses and renders every character and scene offered by the web client", async () => {
    let characters = 0;
    let legacyCharacters = 0;
    let scenes = 0;
    for (const directory of artDirectories) {
      const files = (await readdir(directory)).filter((file) => /\.(?:avb|bgb)$/i.test(file));
      for (const file of files) {
        const buffer = await bufferFor(new URL(file, directory));
        const avatar = parseAvatar(buffer);
        if (file.endsWith(".bgb")) {
          expect(avatar.type, file).toBe(AvatarType.Backdrop);
          expect(avatar.backdrop, file).toBeDefined();
          const image = await decodeImage(buffer, avatar.backdrop!, avatar.palette);
          expect(image.width * image.height, file).toBeGreaterThan(0);
          scenes += 1;
        } else {
          const body = await bodyForText(buffer, avatar, "Hello there!", newPoseMemory());
          expect(body.bitmap.width * body.bitmap.height, file).toBeGreaterThan(0);
          expect(body.faceX, file).toBeGreaterThanOrEqual(0);
          if (avatar.version === 1) {
            const alpha = body.bitmap.pixels.filter((_, index) => index % 4 === 3);
            expect(alpha.some((value) => value === 0), file).toBe(true);
            expect(alpha.some((value) => value === 255), file).toBe(true);
            legacyCharacters += 1;
          }
          characters += 1;
        }
      }
    }
    expect(characters).toBe(56);
    expect(legacyCharacters).toBe(21);
    expect(scenes).toBe(9);
  });
});
