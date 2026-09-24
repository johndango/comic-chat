const BETTY_BOT_NICKNAME = "bettybot";

/** Keep help-bot messages in history while optionally omitting them from comic rendering/export. */
export function visibleComicLines<T extends { characterName: string }>(
  lines: readonly T[],
  hideBettyBot: boolean,
): readonly T[] {
  if (!hideBettyBot) return lines;
  return lines.filter((line) => line.characterName.trim().toLocaleLowerCase() !== BETTY_BOT_NICKNAME);
}
