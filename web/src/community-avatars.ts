export interface CommunityAvatarEntry {
  id: string;
  name: string;
  announcementName: string;
  file: string;
  creator?: string;
  description?: string;
  sourceUrl?: string;
}

export interface CommunityAvatarCatalog {
  version: 1;
  avatars: CommunityAvatarEntry[];
}

const safeIdentifier = /^[A-Za-z0-9_-]{1,60}$/u;
const safeFilename = /^[A-Za-z0-9_.-]{1,100}\.avb$/iu;

function shortText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return clean ? clean.slice(0, maximum) : undefined;
}

function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseCommunityAvatarCatalog(value: unknown): CommunityAvatarCatalog {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const candidates = Array.isArray(source.avatars) ? source.avatars : [];
  const avatars: CommunityAvatarEntry[] = [];
  const ids = new Set<string>();
  const files = new Set<string>();

  for (const candidate of candidates.slice(0, 500)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    const id = shortText(entry.id, 60);
    const name = shortText(entry.name, 60);
    const announcementName = shortText(entry.announcementName, 60);
    const file = shortText(entry.file, 100);
    if (!id || !name || !announcementName || !file) continue;
    if (!safeIdentifier.test(id) || !safeIdentifier.test(announcementName) || !safeFilename.test(file)) continue;
    const idKey = id.toLocaleLowerCase();
    const fileKey = file.toLocaleLowerCase();
    if (ids.has(idKey) || files.has(fileKey)) continue;
    ids.add(idKey);
    files.add(fileKey);
    const creator = shortText(entry.creator, 80);
    const description = shortText(entry.description, 240);
    const sourceUrl = safeSourceUrl(entry.sourceUrl);
    avatars.push({
      id,
      name,
      announcementName,
      file,
      ...(creator ? { creator } : {}),
      ...(description ? { description } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }
  return { version: 1, avatars };
}
