import { describe, expect, it } from "vitest";
import { parseAvatar } from "./avb";
import { avatarDownloadName, buildSimpleAvatar, validateCreatorArt } from "./avatar-creator";
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

  it("makes safe filenames and rejects oversized art", () => {
    expect(avatarDownloadName("  Dr. Åwesome!  ")).toBe("dr-awesome.avb");
    expect(() => validateCreatorArt({ width: 513, height: 20, pixels: new Uint8Array(513 * 20 * 4) }))
      .toThrow("512×512");
  });
});
