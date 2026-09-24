export type AvatarArtPreference = "none" | "monochrome" | "color";

export interface AvatarDisplayPolicy {
  officialOnly: boolean;
  artPreference: AvatarArtPreference;
  forced: Record<string, string>;
}

export interface AvatarAnnouncement {
  name: string;
  url?: string;
}

export const DEFAULT_AVATAR_DISPLAY_POLICY: AvatarDisplayPolicy = {
  officialOnly: true,
  artPreference: "none",
  forced: {},
};

export interface AvatarEditionPair {
  monochrome: string;
  color: string;
}

export function ircNicknameKey(nickname: string): string {
  return nickname.trim().toLocaleLowerCase().replaceAll("[", "{").replaceAll("]", "}").replaceAll("\\", "|").replaceAll("^", "~");
}

export function avatarRuleKey(network: string, nickname: string): string {
  return `${network.toLocaleLowerCase()}:${ircNicknameKey(nickname)}`;
}

export function parseAvatarDisplayPolicy(raw: string | null, officialFiles: ReadonlySet<string>): AvatarDisplayPolicy {
  if (!raw) return { ...DEFAULT_AVATAR_DISPLAY_POLICY, forced: {} };
  try {
    const value = JSON.parse(raw) as { officialOnly?: unknown; artPreference?: unknown; forced?: unknown };
    const forced: Record<string, string> = {};
    if (value.forced && typeof value.forced === "object" && !Array.isArray(value.forced)) {
      for (const [key, file] of Object.entries(value.forced).slice(0, 256)) {
        if (typeof file === "string" && officialFiles.has(file)) forced[key] = file;
      }
    }
    return {
      officialOnly: typeof value.officialOnly === "boolean" ? value.officialOnly : true,
      artPreference: value.artPreference === "monochrome" || value.artPreference === "color" ? value.artPreference : "none",
      forced,
    };
  } catch {
    return { ...DEFAULT_AVATAR_DISPLAY_POLICY, forced: {} };
  }
}

export function preferAvatarEdition(
  file: string,
  preference: AvatarArtPreference,
  editions?: ReadonlyMap<string, AvatarEditionPair>,
): string {
  if (preference === "none" || !editions) return file;
  const pair = editions.get(file);
  return pair?.[preference] ?? file;
}

export function parseAvatarAnnouncement(message: string): AvatarAnnouncement | undefined {
  const match = message.trim().match(/^#\s+Appears as\s+([A-Za-z0-9_-]{1,60})(?:\.(\?|https?:\/\/\S{1,2048}))?$/iu);
  if (!match) return undefined;
  const safeUrl = match[2]?.startsWith("https://") ? match[2] : undefined;
  return { name: match[1], ...(safeUrl ? { url: safeUrl } : {}) };
}

export function resolveAvatarFile(options: {
  network: string;
  nickname: string;
  forced: Readonly<Record<string, string>>;
  announcedOfficialFile?: string;
  announcedCustomFile?: string;
  officialOnly?: boolean;
  artPreference?: AvatarArtPreference;
  editions?: ReadonlyMap<string, AvatarEditionPair>;
  fallbackFile: string;
}): string {
  const forced = options.forced[avatarRuleKey(options.network, options.nickname)];
  if (forced) return forced;
  const selected = options.announcedOfficialFile
    ?? (options.officialOnly ? undefined : options.announcedCustomFile)
    ?? options.fallbackFile;
  return preferAvatarEdition(selected, options.artPreference ?? "none", options.editions);
}
