import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchAvatarFile, MAX_AVATAR_FILE_BYTES, sameOriginAvatarUrl, validateAvatarImport } from "./avatar-import";

async function art(name: string): Promise<ArrayBuffer> {
  const source = await readFile(resolve(import.meta.dirname, `../../v2.5-beta-1-modern/comicart/${name}`));
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

describe("custom avatar imports", () => {
  it("fully validates an original character", async () => {
    const bytes = await art("connor.avb");
    const imported = await validateAvatarImport(bytes, "connor.avb");
    expect(imported.name).toBe("CONNOR");
    expect(imported.metadata.bodies.length).toBeGreaterThan(0);
  });

  it("rejects backdrops and oversized files", async () => {
    const bytes = await art("room.bgb");
    await expect(validateAvatarImport(bytes, "room.bgb"))
      .rejects.toThrow("not a backdrop");
    await expect(validateAvatarImport(new ArrayBuffer(MAX_AVATAR_FILE_BYTES + 1), "huge.avb"))
      .rejects.toThrow("4 MB");
  });

  it("allows only same-origin HTTPS .avb addresses", () => {
    const page = new URL("https://webcomicchat.com/room");
    expect(sameOriginAvatarUrl("https://webcomicchat.com/avatars/pip.avb#old", page))
      .toBe("https://webcomicchat.com/avatars/pip.avb");
    expect(sameOriginAvatarUrl("https://elsewhere.example/pip.avb", page)).toBeUndefined();
    expect(sameOriginAvatarUrl("https://webcomicchat.com/pip.png", page)).toBeUndefined();
    expect(sameOriginAvatarUrl("https://webcomicchat.com/pip.avb", new URL("http://localhost:5173"))).toBeUndefined();
  });

  it("stops reading a hosted response once it exceeds the limit", async () => {
    const response = new Response(new Uint8Array(MAX_AVATAR_FILE_BYTES + 1));
    await expect(fetchAvatarFile("https://webcomicchat.com/avatars/huge.avb", async () => response))
      .rejects.toThrow("4 MB");
  });
});
