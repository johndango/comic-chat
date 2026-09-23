import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AvatarType, PaletteType, decodeImage, parseAvatar } from "./avb";

const artDirectory = new URL("../../v2.5-beta-1-modern/comicart/", import.meta.url);
const simpleAvatars = ["connor.avb", "glenda.avb", "jordan.avb", "pedagog.avb", "rainbow.avb", "tux.avb", "waf.avb"];
const backdrops = ["room.bgb", "space.bgb", "clouds.bgb", "field.bgb", "pastoral.bgb", "yellow.bgb", "buckroom.bgb"];

async function asset(name: string): Promise<ArrayBuffer> {
  const bytes = await readFile(new URL(name, artDirectory));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("Comic Chat art decoder", () => {
  it("parses and decodes an original backdrop", async () => {
    const buffer = await asset("room.bgb");
    const parsed = parseAvatar(buffer);

    expect(parsed.type).toBe(AvatarType.Backdrop);
    expect(parsed.backdrop).toMatchObject({ format: 1, paletteType: PaletteType.Local });

    const image = await decodeImage(buffer, parsed.backdrop!, parsed.palette);
    expect(image.width).toBe(315);
    expect(image.height).toBe(315);
    expect(image.pixels.some((value) => value !== 0)).toBe(true);
  });

  it("parses transparency from an original simple avatar", async () => {
    const buffer = await asset("connor.avb");
    const parsed = parseAvatar(buffer);

    expect(parsed.type).toBe(AvatarType.Simple);
    expect(parsed.name).toBe("CONNOR");
    expect(parsed.bodies).toHaveLength(15);
    expect(parsed.bodies[0].image.paletteType).toBe(PaletteType.MaskedMonochrome);

    const image = await decodeImage(buffer, parsed.bodies[0].image, parsed.palette);
    const alpha = image.pixels.filter((_, index) => index % 4 === 3);
    expect(image.width).toBe(187);
    expect(image.height).toBe(416);
    expect(alpha.some((value) => value === 0)).toBe(true);
    expect(alpha.some((value) => value === 255)).toBe(true);
  });

  it.each(simpleAvatars)("decodes every selectable simple avatar: %s", async (name) => {
    const buffer = await asset(name);
    const parsed = parseAvatar(buffer);
    expect(parsed.type).toBe(AvatarType.Simple);
    expect(parsed.bodies.length).toBeGreaterThan(0);
    const images = await Promise.all(
      parsed.bodies.map((pose) => decodeImage(buffer, pose.image, parsed.palette)),
    );
    expect(images.every((image) => image.width * image.height > 0)).toBe(true);
  });

  it.each(backdrops)("decodes every selectable backdrop: %s", async (name) => {
    const buffer = await asset(name);
    const parsed = parseAvatar(buffer);
    expect(parsed.type).toBe(AvatarType.Backdrop);
    const image = await decodeImage(buffer, parsed.backdrop!, parsed.palette);
    expect(image.width * image.height).toBeGreaterThan(0);
  });
});
