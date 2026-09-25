import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_BACKDROP_FILE_BYTES, validateBackdropImport } from "./backdrop-import";

async function art(name: string): Promise<ArrayBuffer> {
  const source = await readFile(resolve(import.meta.dirname, `../../v2.5-beta-1-modern/comicart/${name}`));
  return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
}

describe("custom background imports", () => {
  it("fully validates and decodes a Comic Chat backdrop", async () => {
    const imported = await validateBackdropImport(await art("room.bgb"), "My room.bgb");
    expect(imported.name).toBe("My room");
    expect(imported.bitmap.width).toBe(315);
    expect(imported.bitmap.height).toBe(315);
    expect(imported.bitmap.pixels.some((value) => value !== 0)).toBe(true);
  });

  it("rejects characters and oversized files", async () => {
    await expect(validateBackdropImport(await art("connor.avb"), "connor.avb"))
      .rejects.toThrow("not a character");
    await expect(validateBackdropImport(new ArrayBuffer(MAX_BACKDROP_FILE_BYTES + 1), "huge.bgb"))
      .rejects.toThrow("2 MB");
  });
});
