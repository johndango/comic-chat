export const FILTERABLE_COMIC_BOTS = ["BettyBot", "TongueTiedBot", "n00bBot"] as const;

export function normalizedComicNickname(nickname: string): string {
  return nickname.trim().toLocaleLowerCase();
}

/** Libera may temporarily append _NN while a registered bot reclaims its nick. */
export function isComicBotNickname(nickname: string, botNickname: string): boolean {
  const nicknameKey = normalizedComicNickname(nickname);
  const botKey = normalizedComicNickname(botNickname);
  return nicknameKey === botKey || new RegExp(`^${botKey}_\\d{2}$`, "u").test(nicknameKey);
}

export function parseHiddenComicBots(raw: string | null, legacyHideBettyBot = false): Set<string> {
  const hidden = new Set<string>();
  if (legacyHideBettyBot) hidden.add("bettybot");
  if (!raw) return hidden;
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return hidden;
    const allowed = new Set(FILTERABLE_COMIC_BOTS.map(normalizedComicNickname));
    for (const value of values) {
      if (typeof value !== "string") continue;
      const nickname = normalizedComicNickname(value);
      if (allowed.has(nickname)) hidden.add(nickname);
    }
  } catch {}
  return hidden;
}

/** Keep bot messages in history while optionally omitting them from comic rendering/export. */
export function visibleComicLines<T extends { characterName: string }>(
  lines: readonly T[],
  hiddenBots: ReadonlySet<string>,
): readonly T[] {
  if (hiddenBots.size === 0) return lines;
  return lines.filter((line) =>
    ![...hiddenBots].some((botNickname) => isComicBotNickname(line.characterName, botNickname)));
}
