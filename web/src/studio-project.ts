export const STUDIO_PROJECT_FORMAT = "webcomicchat-studio";
export const STUDIO_PROJECT_VERSION = 1;
export const MAX_STUDIO_PROJECT_LINES = 200;

export const STUDIO_PROJECT_MODES = ["say", "think", "whisper", "action"] as const;
export const STUDIO_PROJECT_PLACEMENTS = ["new", "current", "auto"] as const;
export const STUDIO_PROJECT_POSES = [
  "auto", "neutral", "happy", "coy", "bored", "scared", "sad", "angry",
  "shout", "laugh", "wave", "point-other", "point-self", "shrug",
] as const;

export type StudioProjectMode = typeof STUDIO_PROJECT_MODES[number];
export type StudioProjectPlacement = typeof STUDIO_PROJECT_PLACEMENTS[number];
export type StudioProjectPose = typeof STUDIO_PROJECT_POSES[number];

export interface StudioProjectLine {
  /** Stable catalog id, not a build-specific asset URL. */
  characterId: string;
  characterName: string;
  message: string;
  mode: StudioProjectMode;
  placement: StudioProjectPlacement;
  reaction: boolean;
  studioPose: StudioProjectPose;
  talkTo: string[];
}

export interface StudioProject {
  format: typeof STUDIO_PROJECT_FORMAT;
  version: typeof STUDIO_PROJECT_VERSION;
  title: string;
  backgroundId: string;
  fontId: string;
  lines: StudioProjectLine[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function limitedString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} must be ${allowEmpty ? `at most ${maximum}` : `between 1 and ${maximum}`} characters`);
  }
  return value;
}

function member<T extends readonly string[]>(value: unknown, choices: T, label: string): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${label} is not supported`);
  return value as T[number];
}

export function createStudioProject(
  title: string,
  backgroundId: string,
  fontId: string,
  lines: readonly StudioProjectLine[],
): StudioProject {
  return {
    format: STUDIO_PROJECT_FORMAT,
    version: STUDIO_PROJECT_VERSION,
    title,
    backgroundId,
    fontId,
    lines: lines.map((line) => ({ ...line, talkTo: [...line.talkTo] })),
  };
}

export function parseStudioProject(source: string): StudioProject {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new Error("This is not a readable WebComicChat Studio project");
  }
  const project = record(decoded);
  if (!project || project.format !== STUDIO_PROJECT_FORMAT) {
    throw new Error("This is not a WebComicChat Studio project");
  }
  if (project.version !== STUDIO_PROJECT_VERSION) {
    throw new Error(`Studio project version ${String(project.version)} is not supported`);
  }
  const title = limitedString(project.title, "Project title", 80, true);
  const backgroundId = limitedString(project.backgroundId, "Project background", 120);
  const fontId = limitedString(project.fontId, "Project font", 80);
  if (!Array.isArray(project.lines) || project.lines.length > MAX_STUDIO_PROJECT_LINES) {
    throw new Error(`A Studio project can contain at most ${MAX_STUDIO_PROJECT_LINES} character beats`);
  }
  const lines = project.lines.map((value, index): StudioProjectLine => {
    const line = record(value);
    if (!line) throw new Error(`Character beat ${index + 1} is invalid`);
    if (!Array.isArray(line.talkTo) || line.talkTo.length > 12) {
      throw new Error(`Character beat ${index + 1} has an invalid audience`);
    }
    if (typeof line.reaction !== "boolean") {
      throw new Error(`Character beat ${index + 1} has an invalid silent-reaction setting`);
    }
    return {
      characterId: limitedString(line.characterId, `Character beat ${index + 1} character`, 120),
      characterName: limitedString(line.characterName, `Character beat ${index + 1} name`, 32),
      message: limitedString(line.message, `Character beat ${index + 1} dialogue`, 180, true),
      mode: member(line.mode, STUDIO_PROJECT_MODES, `Character beat ${index + 1} balloon`),
      placement: member(line.placement, STUDIO_PROJECT_PLACEMENTS, `Character beat ${index + 1} placement`),
      reaction: line.reaction,
      studioPose: member(line.studioPose, STUDIO_PROJECT_POSES, `Character beat ${index + 1} pose`),
      talkTo: line.talkTo.map((name, audienceIndex) =>
        limitedString(name, `Character beat ${index + 1} audience ${audienceIndex + 1}`, 32)),
    };
  });
  return createStudioProject(title, backgroundId, fontId, lines);
}

export function studioProjectJson(project: StudioProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}
