import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeImage, parseAvatar, type ImageDescriptor } from "./avb";
import { readAvbDocument, Tag, writeAvbDocument, type AvbDocument } from "./avb-document";

const art = new URL("../../v2.5-beta-1-modern/comicart/", import.meta.url);
const files = readdirSync(art).filter((f) => f.endsWith(".avb") || f.endsWith(".bgb")).sort();
const load = (file: string) => new Uint8Array(readFileSync(new URL(file, art)));
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Tags before AK_STARTDATA, in file order, and where the data section begins. */
function walkRecords(bytes: Uint8Array): { tags: number[]; dataStart: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags: number[] = [];
  let at = 6;
  for (;;) {
    const tag = view.getUint16(at, true);
    at += 2;
    tags.push(tag);
    if (tag === Tag.StartData) return { tags, dataStart: at };
    if (tag >= 256) at += 2 + view.getUint16(at, true);
    else if (tag === Tag.Name) at = bytes.indexOf(0, at) + 1;
    else if (tag === Tag.Flags || tag === Tag.Style) at += 2;
    else at += 2 + view.getUint16(at, true) * (tag === Tag.Faces ? 33 : 25);
  }
}
const recordTags = (bytes: Uint8Array) => walkRecords(bytes).tags;

/** Every present image descriptor a display decoder would use. */
function descriptors(bytes: Uint8Array): ImageDescriptor[] {
  const a = parseAvatar(buffer(bytes));
  const poses = [...a.bodies, ...a.faces, ...a.torsos];
  return [a.icon, a.backdrop, ...poses.flatMap((p) => [p.image, p.mask, p.aura])].filter(
    (d): d is ImageDescriptor => !!d && d.offset > 0,
  );
}

describe("readAvbDocument / writeAvbDocument round trip", () => {
  it("covers all 32 shipped art files", () => {
    expect(files).toHaveLength(32);
  });

  it.each(files)("%s survives read → write → read unchanged", async (file) => {
    const original = load(file);
    const doc = await readAvbDocument(original);
    const written = await writeAvbDocument(doc);
    const again = await readAvbDocument(written);
    expect(again).toEqual(doc);
    // Same record sequence as the shipped file.
    expect(recordTags(written)).toEqual(recordTags(original));
  });

  it.each(files)("%s decodes pixel-for-pixel identically after rewriting", async (file) => {
    const original = load(file);
    const written = await writeAvbDocument(await readAvbDocument(original));
    const before = parseAvatar(buffer(original));
    const after = parseAvatar(buffer(written));
    expect({ ...after, icon: undefined, backdrop: undefined, bodies: [], faces: [], torsos: [] }).toEqual({
      ...before,
      icon: undefined,
      backdrop: undefined,
      bodies: [],
      faces: [],
      torsos: [],
    });
    const a = descriptors(original);
    const b = descriptors(written);
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i += 1) {
      const [x, y] = await Promise.all([
        decodeImage(buffer(original), a[i], before.palette),
        decodeImage(buffer(written), b[i], after.palette),
      ]);
      expect(y.width).toBe(x.width);
      expect(y.height).toBe(x.height);
      expect(Buffer.from(y.pixels).equals(Buffer.from(x.pixels))).toBe(true);
    }
    // Pose metadata (emotions, anchors) is identical too.
    const strip = (poses: typeof before.bodies) => poses.map(({ emotion, intensity, x, y, anchor }) => ({ emotion, intensity, x, y, anchor }));
    expect(strip(after.bodies)).toEqual(strip(before.bodies));
    expect(strip(after.faces)).toEqual(strip(before.faces));
    expect(strip(after.torsos)).toEqual(strip(before.torsos));
  });
});

describe("new records", () => {
  it("writes and reads back the download URL and usage flags", async () => {
    const doc = await readAvbDocument(load("tux.avb"));
    const edited: AvbDocument = {
      ...doc,
      name: "Tux (remix)",
      copyright: "© 2026 Example Artist · CC BY 4.0",
      originalUrl: "https://webcomicchat.com/art/tux-remix.avb",
      usageFlags: 1,
    };
    const again = await readAvbDocument(await writeAvbDocument(edited));
    expect(again.name).toBe("Tux (remix)");
    expect(again.copyright).toBe("© 2026 Example Artist · CC BY 4.0");
    expect(again.originalUrl).toBe("https://webcomicchat.com/art/tux-remix.avb");
    expect(again.usageFlags).toBe(1);
    // The display decoder still reads it (it skips the records it doesn't know).
    expect(parseAvatar(buffer(await writeAvbDocument(edited))).name).toBe("Tux (remix)");
  });

  it("keeps records it doesn't understand", async () => {
    const doc = await readAvbDocument(load("tux.avb"));
    const withUnknown = { ...doc, unknownRecords: [{ tag: 300, payload: new Uint8Array([1, 2, 3]) }] };
    const again = await readAvbDocument(await writeAvbDocument(withUnknown));
    expect(again.unknownRecords).toEqual([{ tag: 300, payload: new Uint8Array([1, 2, 3]) }]);
  });

  it("rejects documents that point at missing images", async () => {
    const doc = await readAvbDocument(load("tux.avb"));
    await expect(writeAvbDocument({ ...doc, icon: 999 })).rejects.toThrow("missing image");
  });

  it("rejects truncated files and absurd bitmap sizes", async () => {
    const bytes = load("tux.avb");
    await expect(readAvbDocument(bytes.slice(0, 40))).rejects.toThrow();
    // Patch the first bitmap's width to 60,000 pixels.
    const written = await writeAvbDocument(await readAvbDocument(bytes));
    const view = new DataView(written.buffer);
    let header = walkRecords(written).dataStart;
    // The first image may start with its local palette record.
    if (view.getUint16(header, true) === Tag.Palette) header += 4 + view.getUint16(header + 2, true);
    expect(view.getUint32(header, true)).toBe(40); // BITMAPINFOHEADER.biSize
    view.setInt32(header + 4, 60_000, true); // biWidth
    await expect(readAvbDocument(written)).rejects.toThrow("out of range");
  });
});
