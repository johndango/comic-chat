// Words for the comic, for people who can't see it: a description of each
// panel for screen readers, and one line per message for the Plain Text view
// (Comic Chat's View menu let you switch the comic off and read the chat).

import type { BalloonMode } from "./layout/balloon";

const VERBS: Record<BalloonMode, string> = { say: "says", think: "thinks", whisper: "whispers", action: "" };

/** "Panel 2. Anna says: Hi everybody. Dan thinks: Hmm." */
export function describePanel(
  index: number,
  balloons: ReadonlyArray<{ speakerId: string; mode: BalloonMode; text: string }>,
  bodies: ReadonlyArray<{ id: string }>,
): string {
  const said = balloons.map(({ speakerId, mode, text }) => {
    const words = text.replace(/\s+/gu, " ").trim();
    return mode === "action" ? `${speakerId} ${words}.` : `${speakerId} ${VERBS[mode]}: ${words}`;
  });
  const silent = [...new Set(bodies.map((body) => body.id))].filter((id) => !balloons.some((balloon) => balloon.speakerId === id));
  const present = silent.length ? ` Also in the panel: ${silent.join(", ")}.` : "";
  return `Panel ${index + 1}. ${said.join(" ") || "No one speaks."}${present}`.trim();
}

export interface TextLine {
  characterName: string;
  message: string;
  mode: BalloonMode;
  talkTo: readonly string[];
  reaction?: boolean;
}

/** One line of the Plain Text view, as an IRC client would show it. */
export function transcriptLine(line: TextLine): string {
  const to = line.talkTo.length ? ` to ${line.talkTo.join(", ")}` : "";
  if (line.reaction) return `${line.characterName} appears.`;
  switch (line.mode) {
    case "action":
      return `* ${line.characterName} ${line.message}`;
    case "think":
      return `${line.characterName} thinks: ${line.message}`;
    case "whisper":
      return `${line.characterName} whispers${to}: ${line.message}`;
    default:
      return `${line.characterName}${to ? ` (${to.slice(1)})` : ""}: ${line.message}`;
  }
}
