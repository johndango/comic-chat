export interface AvatarDisplayPolicy {
  officialOnly: boolean;
  forced: Record<string, string>;
}

export interface AvatarAnnouncement {
  name: string;
  url?: string;
}

export const DEFAULT_AVATAR_DISPLAY_POLICY: AvatarDisplayPolicy = {
  officialOnly: true,
  forced: {},
};

export function ircNicknameKey(nickname: string): string {
  return nickname.trim().toLocaleLowerCase().replaceAll("[", "{").replaceAll("]", "}").replaceAll("\\", "|").replaceAll("^", "~");
}

export function avatarRuleKey(network: string, nickname: string): string {
  return `${network.toLocaleLowerCase()}:${ircNicknameKey(nickname)}`;
}

export function parseAvatarDisplayPolicy(raw: string | null, officialFiles: ReadonlySet<string>): AvatarDisplayPolicy {
  if (!raw) return { ...DEFAULT_AVATAR_DISPLAY_POLICY, forced: {} };
  try {
    const value = JSON.parse(raw) as { officialOnly?: unknown; forced?: unknown };
    const forced: Record<string, string> = {};
    if (value.forced && typeof value.forced === "object" && !Array.isArray(value.forced)) {
      for (const [key, file] of Object.entries(value.forced).slice(0, 256)) {
        if (typeof file === "string" && officialFiles.has(file)) forced[key] = file;
      }
    }
    return {
      officialOnly: typeof value.officialOnly === "boolean" ? value.officialOnly : true,
      forced,
    };
  } catch {
    return { ...DEFAULT_AVATAR_DISPLAY_POLICY, forced: {} };
  }
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
  fallbackFile: string;
}): string {
  return options.forced[avatarRuleKey(options.network, options.nickname)]
    ?? options.announcedOfficialFile
    ?? (options.officialOnly ? undefined : options.announcedCustomFile)
    ?? options.fallbackFile;
}
