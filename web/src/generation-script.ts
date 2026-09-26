// The comic generator (/generation): a panel-by-panel JSON script, written by
// an AI chat assistant from a brief this page provides, turned into a Studio
// project so the comic is drawn by the same engine and can be edited after.
// Every error names the panel and beat, and says what's allowed, so the
// message can be pasted straight back to the assistant.

import {
  createStudioProject,
  STUDIO_PROJECT_MODES,
  STUDIO_PROJECT_POSES,
  type StudioProject,
  type StudioProjectLine,
  type StudioProjectMode,
  type StudioProjectPose,
} from "./studio-project";

export const GENERATION_FORMAT = "webcomicchat-generation";

/** What this version of the site can draw. */
export interface GenerationCatalog {
  characters: ReadonlyArray<{ name: string; id: string }>;
  backgrounds: ReadonlyArray<{ name: string; id: string }>;
  fonts: ReadonlyArray<{ name: string; id: string }>;
}

// Comic Chat's limits (panel.cpp MAXBODIES / MAXBALLOONS, the 180-character
// message box, the Studio's 200 beats).
export const GENERATION_LIMITS = { castSize: 12, charactersPerPanel: 5, balloonsPerPanel: 5, textLength: 180, beats: 200, titleLength: 80, nameLength: 32 };

export interface GenerationResult {
  project?: StudioProject;
  errors: string[];
  warnings: string[];
  panels: number;
}

const BALLOONS: Record<string, StudioProjectMode> = { say: "say", think: "think", whisper: "whisper", action: "action", caption: "action" };
const POSE_ALIASES: Record<string, StudioProjectPose> = { point: "point-other", "point-at-other": "point-other", "point-at-self": "point-self", yell: "shout", excited: "happy", smile: "happy", cry: "sad", mad: "angry", afraid: "scared" };

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const fold = (text: string) => text.trim().toLocaleLowerCase().replace(/\s+/gu, " ");

function lookup<T extends { name: string; id: string }>(list: readonly T[], value: string): T | undefined {
  const wanted = fold(value);
  return list.find((item) => fold(item.name) === wanted || fold(item.id) === wanted);
}

function unknownKeys(value: Json, allowed: readonly string[], where: string, warnings: string[]): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) warnings.push(`${where}: ignored ${extra.map((key) => `"${key}"`).join(", ")} (allowed: ${allowed.join(", ")}).`);
}

/** Pull the JSON out of an assistant's reply, which is often wrapped in a ```json fence or a sentence. */
export function extractJson(source: string): string {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/u);
  if (fenced) return fenced[1].trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  return start >= 0 && end > start ? source.slice(start, end + 1) : source.trim();
}

export function convertGenerationScript(source: string, catalog: GenerationCatalog): GenerationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(extractJson(source));
  } catch (error) {
    return { errors: [`The script isn't valid JSON (${error instanceof Error ? error.message : "unreadable"}). Reply with only the JSON object.`], warnings, panels: 0 };
  }
  if (!isRecord(decoded)) return { errors: ["The script must be one JSON object with \"cast\" and \"panels\"."], warnings, panels: 0 };
  const script = decoded;
  unknownKeys(script, ["format", "title", "background", "font", "cast", "panels"], "Script", warnings);
  if (script.format !== undefined && script.format !== GENERATION_FORMAT) warnings.push(`"format" should be "${GENERATION_FORMAT}".`);

  const title = typeof script.title === "string" ? script.title.trim() : "";
  if (script.title !== undefined && typeof script.title !== "string") errors.push("\"title\" must be text.");
  if (title.length > GENERATION_LIMITS.titleLength) errors.push(`"title" is ${title.length} characters; the most is ${GENERATION_LIMITS.titleLength}.`);

  const backgroundName = typeof script.background === "string" ? script.background : catalog.backgrounds[0]?.name ?? "";
  const background = lookup(catalog.backgrounds, backgroundName);
  if (!background) errors.push(`Background "${String(script.background)}" doesn't exist. Choose one of: ${catalog.backgrounds.map((b) => b.name).join(", ")}.`);

  const fontName = typeof script.font === "string" ? script.font : catalog.fonts[0]?.name ?? "";
  const font = lookup(catalog.fonts, fontName);
  if (!font) errors.push(`Font "${String(script.font)}" doesn't exist. Choose one of: ${catalog.fonts.map((f) => f.name).join(", ")}.`);

  // Cast: the names people use in the comic → which character draws them.
  const cast = new Map<string, { name: string; id: string }>();
  if (!isRecord(script.cast) || Object.keys(script.cast).length === 0) {
    errors.push("\"cast\" must map each name in the comic to a character, like {\"Mia\": \"Anna\", \"Rex\": \"Dan\"}.");
  } else {
    const entries = Object.entries(script.cast);
    if (entries.length > GENERATION_LIMITS.castSize) errors.push(`The cast has ${entries.length} people; the most is ${GENERATION_LIMITS.castSize}.`);
    for (const [name, value] of entries) {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > GENERATION_LIMITS.nameLength || /[\u0000-\u001f]/u.test(trimmed)) {
        errors.push(`Cast name "${name}" must be 1 to ${GENERATION_LIMITS.nameLength} characters.`);
        continue;
      }
      if (cast.has(fold(trimmed))) {
        errors.push(`Cast name "${trimmed}" is listed twice.`);
        continue;
      }
      const character = typeof value === "string" ? lookup(catalog.characters, value) : undefined;
      if (!character) {
        errors.push(`Cast "${trimmed}": character "${String(value)}" doesn't exist. Choose one of: ${catalog.characters.map((c) => c.name).join(", ")}.`);
        continue;
      }
      cast.set(fold(trimmed), { name: trimmed, id: character.id });
    }
  }
  const castNames = [...cast.values()].map(({ name }) => name).join(", ");

  const lines: StudioProjectLine[] = [];
  if (!Array.isArray(script.panels) || script.panels.length === 0) {
    errors.push("\"panels\" must be a list with at least one panel.");
    return { errors, warnings, panels: 0 };
  }
  script.panels.forEach((panelValue, panelIndex) => {
    const where = `Panel ${panelIndex + 1}`;
    const panel = isRecord(panelValue) ? panelValue : Array.isArray(panelValue) ? { beats: panelValue } : undefined;
    if (!panel) {
      errors.push(`${where} must be an object like {"beats": [...]} or {"blank": true}.`);
      return;
    }
    unknownKeys(panel, ["beats", "blank"], where, warnings);
    if (panel.blank === true) {
      if (Array.isArray(panel.beats) && panel.beats.length) errors.push(`${where} is marked blank but has beats; use one or the other.`);
      lines.push({ kind: "blank" });
      return;
    }
    if (!Array.isArray(panel.beats) || panel.beats.length === 0) {
      errors.push(`${where} needs a "beats" list (or "blank": true for an empty panel).`);
      return;
    }
    const inPanel = new Set<string>();
    let balloons = 0;
    panel.beats.forEach((beatValue, beatIndex) => {
      const at = `${where}, beat ${beatIndex + 1}`;
      if (!isRecord(beatValue)) {
        errors.push(`${at} must be an object like {"who": "Mia", "text": "Hi!"}.`);
        return;
      }
      const beat = beatValue;
      unknownKeys(beat, ["who", "text", "balloon", "pose", "to", "silent"], at, warnings);
      const who = typeof beat.who === "string" ? cast.get(fold(beat.who)) : undefined;
      if (!who) {
        errors.push(`${at}: "who" is "${String(beat.who)}", who isn't in the cast (${castNames || "empty"}).`);
        return;
      }
      inPanel.add(who.name);
      const silent = beat.silent === true;
      const balloonName = typeof beat.balloon === "string" ? fold(beat.balloon) : "say";
      const mode = BALLOONS[balloonName];
      if (!mode) errors.push(`${at}: balloon "${String(beat.balloon)}" isn't supported. Use one of: ${STUDIO_PROJECT_MODES.join(", ")}.`);
      const text = typeof beat.text === "string" ? beat.text.replace(/\s+/gu, " ").trim() : "";
      if (!silent && !text) errors.push(`${at}: "text" is empty. Give ${who.name} a line, or set "silent": true to show them without a balloon.`);
      if (silent && text) warnings.push(`${at}: "silent" beats have no balloon, so the text was dropped.`);
      if (text.length > GENERATION_LIMITS.textLength) {
        errors.push(`${at}: the text is ${text.length} characters; the most is ${GENERATION_LIMITS.textLength}. Split it into two beats.`);
      }
      const poseName = typeof beat.pose === "string" ? fold(beat.pose).replace(/\s+/gu, "-") : "auto";
      const pose = (STUDIO_PROJECT_POSES as readonly string[]).includes(poseName) ? poseName as StudioProjectPose : POSE_ALIASES[poseName];
      if (!pose) errors.push(`${at}: pose "${String(beat.pose)}" isn't supported. Use one of: ${STUDIO_PROJECT_POSES.join(", ")}.`);
      const toList = beat.to === undefined ? [] : Array.isArray(beat.to) ? beat.to : [beat.to];
      const talkTo: string[] = [];
      for (const target of toList) {
        const person = typeof target === "string" ? cast.get(fold(target)) : undefined;
        if (!person) errors.push(`${at}: "to" names "${String(target)}", who isn't in the cast (${castNames}).`);
        else if (person.name === who.name) errors.push(`${at}: ${who.name} can't talk to themselves; leave "to" out.`);
        else talkTo.push(person.name);
      }
      if (mode === "whisper" && talkTo.length === 0) errors.push(`${at}: a whisper needs "to" (who it's whispered to).`);
      if (!silent) balloons += 1;
      if (!mode || !pose) return;
      lines.push({
        kind: "character",
        characterId: who.id,
        characterName: who.name,
        message: silent ? "" : text.slice(0, GENERATION_LIMITS.textLength),
        mode,
        // The first beat opens the panel; the rest stay in it if they fit.
        placement: beatIndex === 0 ? "new" : "current",
        reaction: silent,
        studioPose: pose,
        talkTo: [...new Set(talkTo)],
      });
    });
    if (inPanel.size > GENERATION_LIMITS.charactersPerPanel) {
      errors.push(`${where} has ${inPanel.size} people (${[...inPanel].join(", ")}); the most is ${GENERATION_LIMITS.charactersPerPanel}. Split it into two panels.`);
    }
    if (balloons > GENERATION_LIMITS.balloonsPerPanel) {
      errors.push(`${where} has ${balloons} balloons; the most is ${GENERATION_LIMITS.balloonsPerPanel}. Split it into two panels.`);
    }
  });
  if (lines.length > GENERATION_LIMITS.beats) errors.push(`The script has ${lines.length} beats; the most is ${GENERATION_LIMITS.beats}.`);
  if (errors.length || !background || !font) return { errors, warnings, panels: script.panels.length };
  return { project: createStudioProject(title, background.id, font.id, lines), errors, warnings, panels: script.panels.length };
}

/** The instructions to give the assistant, listing exactly what this site can draw. */
export function generationBrief(catalog: GenerationCatalog): string {
  const L = GENERATION_LIMITS;
  const example = {
    format: GENERATION_FORMAT,
    title: "The Modem Incident",
    background: catalog.backgrounds[0]?.name ?? "The room",
    font: catalog.fonts[0]?.name ?? "Comic Sans MS",
    cast: { Mia: catalog.characters[0]?.name ?? "Anna", Rex: catalog.characters.find((c) => /^dan$/iu.test(c.name))?.name ?? catalog.characters[1]?.name ?? "Dan" },
    panels: [
      { beats: [
        { who: "Mia", text: "Did you hear that screeching noise?", pose: "scared", to: "Rex" },
        { who: "Rex", text: "That's just my modem connecting!", pose: "laugh" },
      ] },
      { beats: [{ who: "Mia", balloon: "think", text: "It's 1996 forever in here." }] },
      { beats: [{ who: "Rex", balloon: "action", text: "unplugs the phone line" }] },
      { blank: true },
      { beats: [{ who: "Mia", text: "...and now it's quiet.", pose: "shrug" }, { who: "Rex", silent: true, pose: "sad" }] },
    ],
  };
  return [
    "You write comic scripts for webcomicchat.com, a re-creation of Microsoft Comic Chat (1996). Reply with ONE JSON object and nothing else.",
    "",
    "SHAPE",
    `- "format": "${GENERATION_FORMAT}"`,
    `- "title": text, at most ${L.titleLength} characters (shown on the title panel).`,
    '- "background": one location for the whole comic (list below).',
    '- "font": optional (list below).',
    `- "cast": maps each person's name in the comic (1-${L.nameLength} characters) to a character to draw them with. At most ${L.castSize} people.`,
    '- "panels": in reading order. Each panel is {"beats": [...]} or {"blank": true} for an empty pause panel.',
    "- Each beat: {\"who\": cast name, \"text\": what they say, \"balloon\": \"say\" | \"think\" | \"whisper\" | \"action\", \"pose\": pose, \"to\": cast name or list}.",
    '  - "balloon" defaults to "say". "action" is a caption describing what they do, written without their name ("waves hello").',
    '  - "whisper" needs "to". "to" also turns the speaker toward that person.',
    '  - "pose" defaults to "auto" (chosen from the words and punctuation, like the original).',
    '  - {"who": name, "silent": true} puts someone in the panel without a balloon.',
    "",
    "LIMITS",
    `- At most ${L.charactersPerPanel} people and ${L.balloonsPerPanel} balloons per panel; 2-3 balloons reads best.`,
    `- At most ${L.textLength} characters per balloon. Balloons are drawn in capitals, so keep them short and punchy.`,
    "- You can't position people: the engine arranges each panel automatically, like Comic Chat did. Speaking order is balloon order (top to bottom).",
    "- An action caption always starts a new panel, so give it a panel of its own.",
    `- At most ${L.beats} beats in total.`,
    "",
    `POSES: ${STUDIO_PROJECT_POSES.join(", ")}`,
    `CHARACTERS: ${catalog.characters.map((c) => c.name).join(", ")}`,
    `BACKGROUNDS: ${catalog.backgrounds.map((b) => b.name).join(", ")}`,
    `FONTS: ${catalog.fonts.map((f) => f.name).join(", ")}`,
    "",
    "EXAMPLE",
    JSON.stringify(example, null, 2),
    "",
    "If I paste back error messages from the site, fix exactly those problems and reply with the whole corrected JSON.",
  ].join("\n");
}
