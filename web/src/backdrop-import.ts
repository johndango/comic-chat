import { AvatarType, decodeImage, parseAvatar, type DecodedBitmap } from "./avb";
import { AvbType, readAvbDocument } from "./avb-document";

export const MAX_BACKDROP_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BACKDROP_DIMENSION = 2048;
const MAX_BACKDROP_PIXELS = 4 * 1024 * 1024;

export interface ImportedBackdrop {
  name: string;
  bitmap: DecodedBitmap;
}

function fallbackName(filename: string): string {
  const stem = filename.replace(/\.bgb$/iu, "").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return stem.slice(0, 60) || "Imported background";
}

/** Structurally reads and fully decodes a local Comic Chat backdrop before use. */
export async function validateBackdropImport(buffer: ArrayBuffer, filename: string): Promise<ImportedBackdrop> {
  if (buffer.byteLength === 0) throw new Error("That background file is empty");
  if (buffer.byteLength > MAX_BACKDROP_FILE_BYTES) throw new Error("Comic Chat backgrounds must be 2 MB or smaller");
  const document = await readAvbDocument(buffer);
  if (document.version !== 2) throw new Error("Only version 2 Comic Chat backgrounds are supported");
  if (document.type !== AvbType.Backdrop || document.backdrop == null) {
    throw new Error("Choose a Comic Chat backdrop (.bgb), not a character");
  }
  const parsed = parseAvatar(buffer);
  if (parsed.type !== AvatarType.Backdrop || !parsed.backdrop) throw new Error("That backdrop is incomplete");
  const bitmap = await decodeImage(buffer, parsed.backdrop, parsed.palette);
  if (bitmap.width > MAX_BACKDROP_DIMENSION
    || bitmap.height > MAX_BACKDROP_DIMENSION
    || bitmap.width * bitmap.height > MAX_BACKDROP_PIXELS) {
    throw new Error("Backgrounds must be 2048×2048 pixels or smaller");
  }
  return { name: fallbackName(filename), bitmap };
}
