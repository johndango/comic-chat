import { parseAvatar, type AvatarFile } from "./avb";
import { AvbType, readAvbDocument } from "./avb-document";

export const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;

export interface ImportedAvatar {
  metadata: AvatarFile;
  name: string;
}

function fallbackName(filename: string): string {
  const stem = filename.replace(/\.avb$/iu, "").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return stem.slice(0, 60) || "Imported character";
}

/** Fully reads every image so malformed or decompression-bomb art is rejected before use. */
export async function validateAvatarImport(buffer: ArrayBuffer, filename: string): Promise<ImportedAvatar> {
  if (buffer.byteLength === 0) throw new Error("That avatar file is empty");
  if (buffer.byteLength > MAX_AVATAR_FILE_BYTES) throw new Error("Avatar files must be 2 MB or smaller");

  const document = await readAvbDocument(buffer);
  if (document.version !== 2) throw new Error("Only version 2 Comic Chat avatars are supported");
  if (document.type !== AvbType.Simple && document.type !== AvbType.Complex) {
    throw new Error("Choose a Comic Chat character (.avb), not a backdrop");
  }
  const hasSimpleBody = document.type === AvbType.Simple && document.bodies.length > 0;
  const hasCompositeBody = document.faces.length > 0 && document.torsos.length > 0;
  if (!hasSimpleBody && !hasCompositeBody) throw new Error("That file does not contain a supported Comic Chat character");

  const metadata = parseAvatar(buffer);
  const embedded = (document.name ?? metadata.name).replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 60);
  return { metadata, name: embedded || fallbackName(filename) };
}

/** Hosted room art is deliberately restricted to the current HTTPS site. */
export function sameOriginAvatarUrl(raw: string | undefined, pageUrl: URL): string | undefined {
  if (!raw || pageUrl.protocol !== "https:") return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.origin !== pageUrl.origin || url.username || url.password) return undefined;
    if (!url.pathname.toLocaleLowerCase().endsWith(".avb")) return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

export async function fetchAvatarFile(url: string, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  const response = await fetcher(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Could not load hosted avatar (${response.status})`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_FILE_BYTES) throw new Error("Hosted avatar is larger than 2 MB");
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_AVATAR_FILE_BYTES) throw new Error("Hosted avatar is larger than 2 MB");
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_AVATAR_FILE_BYTES) {
        await reader.cancel();
        throw new Error("Hosted avatar is larger than 2 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}
