import { describe, expect, it } from "vitest";
import { parseAvatar } from "./avb";
import { avatarDownloadName, buildCompositeAvatar, buildSimpleAvatar, creatorImageSize, validateCreatorArt } from "./avatar-creator";
import { Emotion, type Rgba } from "./avb-builder";

function pose(): Rgba {
  const pixels = new Uint8ClampedArray(16 * 24 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 255, 255, 255], i);
  return { width: 16, height: 24, pixels };
}

describe("avatar creator", () => {
  it("builds a downloadable version 2 character", async () => {
    const buffer = await buildSimpleAvatar({
      name: "My Hero",
      credit: "Art by Example",
      style: "mono",
      aura: 3,
      poses: [{ art: pose(), emotion: Emotion.Neutral, intensity: 0 }],
    });
    const avatar = parseAvatar(buffer);
    expect(avatar.name).toBe("My Hero");
    expect(avatar.copyright).toBe("Art by Example");
    expect(avatar.bodies).toHaveLength(1);
  });

  it("supports a full expressive set with repeated emotions", async () => {
    const poses = Array.from({ length: 24 }, (_, index) => ({
      art: pose(),
      emotion: index % 2 ? Emotion.Happy : Emotion.Neutral,
      intensity: index % 2 ? index / 24 : 0,
    }));
    const avatar = parseAvatar(await buildSimpleAvatar({ name: "Expressive", style: "mono", aura: 3, poses }));
    expect(avatar.bodies).toHaveLength(24);
  });

  it("builds a mix-and-match character with independently selected faces and bodies", async () => {
    const avatar = parseAvatar(await buildCompositeAvatar({
      name: "Mixy",
      style: "mono",
      aura: 3,
      faces: [{ art: pose(), emotion: Emotion.Happy, intensity: 1, neck: { x: 8, y: 23 } }],
      torsos: [{ art: pose(), emotion: Emotion.Wave, intensity: 1, neck: { x: 8, y: 1 } }],
    }));
    expect(avatar.faces).toHaveLength(1);
    expect(avatar.torsos).toHaveLength(1);
    expect(avatar.bodies).toHaveLength(0);
    expect(avatar.faces[0].anchor).toMatchObject({ cx: 8, cy: 23 });
    expect(avatar.torsos[0]).toMatchObject({ x: 8, y: 1 });
  });

  it("makes safe filenames and rejects oversized art", () => {
    expect(avatarDownloadName("  Dr. Åwesome!  ")).toBe("dr-awesome.avb");
    expect(() => validateCreatorArt({ width: 513, height: 20, pixels: new Uint8Array(513 * 20 * 4) }))
      .toThrow("512×512");
  });

  it("reduces high-resolution source art to the classic logical size", () => {
    expect(creatorImageSize(1200, 1800)).toEqual({ width: 341, height: 512 });
    expect(creatorImageSize(250, 420)).toEqual({ width: 250, height: 420 });
    expect(() => creatorImageSize(2049, 100)).toThrow("2048×2048");
  });
});
