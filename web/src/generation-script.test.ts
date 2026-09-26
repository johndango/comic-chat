import { describe, expect, it } from "vitest";
import { convertGenerationScript, extractJson, generationBrief, normalizeJsonSmartQuotes, type GenerationCatalog } from "./generation-script";
import { parseStudioProject } from "./studio-project";

const catalog: GenerationCatalog = {
  characters: [
    { name: "Anna", id: "classic:anna.avb" },
    { name: "Dan", id: "classic:dan.avb" },
    { name: "Tiki", id: "classic:tiki.avb" },
    { name: "Anna (color)", id: "color:anna" },
  ],
  backgrounds: [{ name: "The room", id: "classic:room.bgb" }, { name: "Deep space", id: "classic:space.bgb" }],
  fonts: [{ name: "Comic Sans MS", id: "comic-sans-ms" }, { name: "Arial", id: "arial" }],
};

const script = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  title: "Test",
  background: "deep space",
  cast: { Mia: "Anna", Rex: "dan" },
  panels: [
    { beats: [{ who: "Mia", text: "Hi Rex!", pose: "happy", to: "Rex" }, { who: "rex", balloon: "think", text: "Who's that?" }] },
    { blank: true },
    { beats: [{ who: "Rex", balloon: "action", text: "waves" }, { who: "Mia", silent: true, pose: "coy" }] },
  ],
  ...overrides,
});

describe("turning an AI script into a Studio project", () => {
  it("converts panels and beats into Studio lines", () => {
    const result = convertGenerationScript(script(), catalog);
    expect(result.errors).toEqual([]);
    expect(result.project).toMatchObject({ title: "Test", backgroundId: "classic:space.bgb", fontId: "comic-sans-ms" });
    expect(result.project!.lines).toEqual([
      { kind: "character", characterId: "classic:anna.avb", characterName: "Mia", message: "Hi Rex!", mode: "say", placement: "new", reaction: false, studioPose: "happy", talkTo: ["Rex"] },
      { kind: "character", characterId: "classic:dan.avb", characterName: "Rex", message: "Who's that?", mode: "think", placement: "current", reaction: false, studioPose: "auto", talkTo: [] },
      { kind: "blank" },
      { kind: "character", characterId: "classic:dan.avb", characterName: "Rex", message: "waves", mode: "action", placement: "new", reaction: false, studioPose: "auto", talkTo: [] },
      { kind: "character", characterId: "classic:anna.avb", characterName: "Mia", message: "", mode: "say", placement: "current", reaction: true, studioPose: "coy", talkTo: [] },
    ]);
    // The Studio accepts it as-is.
    expect(parseStudioProject(JSON.stringify(result.project))).toEqual(result.project);
  });

  it("reads JSON wrapped in an assistant's reply", () => {
    expect(extractJson('Here you go!\n```json\n{"a": 1}\n```\nEnjoy')).toBe('{"a": 1}');
    expect(extractJson('Sure: {"a": {"b": 2}} hope that helps')).toBe('{"a": {"b": 2}}');
    expect(extractJson('Sure: {"a": "a } brace"} then use {braces} if you edit it')).toBe('{"a": "a } brace"}');
    expect(convertGenerationScript(`Here's your comic:\n\`\`\`json\n${script()}\n\`\`\``, catalog).errors).toEqual([]);
  });

  it("accepts smart JSON quotes copied on iOS without changing dialogue quotes", () => {
    const mobile = `{“format”:“webcomicchat-generation”,“cast”:{“Mia”:“Anna”},“panels”:[{“beats”:[{“who”:“Mia”,“text”:“She said “hello,” today”}]}]}`;
    expect(normalizeJsonSmartQuotes(`{“format”:“webcomicchat-generation”}`)).toBe('{"format":"webcomicchat-generation"}');
    const result = convertGenerationScript(mobile, catalog);
    expect(result.errors).toEqual([]);
    expect(result.project?.lines[0]).toMatchObject({ message: "She said “hello,” today" });
  });

  it("gives errors that say what's allowed, so they can go back to the assistant", () => {
    const result = convertGenerationScript(script({
      background: "The moon",
      cast: { Mia: "Anna", Bob: "Batman" },
      panels: [
        { beats: [{ who: "Mia", text: "hi", pose: "dancing" }, { who: "Zed", text: "yo" }, { who: "Mia", balloon: "whisper", text: "psst" }] },
        { beats: [{ who: "Mia", text: "x".repeat(200) }] },
        { beats: [] },
      ],
    }), catalog);
    expect(result.project).toBeUndefined();
    expect(result.errors).toEqual([
      'Background "The moon" doesn\'t exist. Choose one of: The room, Deep space.',
      'Cast "Bob": character "Batman" doesn\'t exist. Choose one of: Anna, Dan, Tiki, Anna (color).',
      "Panel 1, beat 1: pose \"dancing\" isn't supported. Use one of: auto, neutral, happy, coy, bored, scared, sad, angry, shout, laugh, wave, point-other, point-self, shrug.",
      'Panel 1, beat 2: "who" is "Zed", who isn\'t in the cast (Mia).',
      'Panel 1, beat 3: a whisper needs "to" (who it\'s whispered to).',
      "Panel 2, beat 1: the text is 200 characters; the most is 180. Split it into two beats.",
      'Panel 3 needs a "beats" list (or "blank": true for an empty panel).',
    ]);
  });

  it("enforces Comic Chat's per-panel limits", () => {
    const six = { Mia: "Anna", Rex: "Dan", A: "Tiki", B: "Anna", C: "Dan", D: "Tiki" };
    const beats = Object.keys(six).map((who) => ({ who, text: "hi" }));
    const errors = convertGenerationScript(script({ cast: six, panels: [{ beats }] }), catalog).errors;
    expect(errors).toContain("Panel 1 has 6 people (Mia, Rex, A, B, C, D); the most is 5. Split it into two panels.");
    expect(errors).toContain("Panel 1 has 6 balloons; the most is 5. Split it into two panels.");

    const listeners = convertGenerationScript(script({
      cast: six,
      panels: [{ beats: [{ who: "Mia", text: "Everybody listen!", to: ["Rex", "A", "B", "C", "D"] }] }],
    }), catalog).errors;
    expect(listeners).toContain("Panel 1 has 6 people (Mia, Rex, A, B, C, D); the most is 5. Split it into two panels.");
  });

  it("accepts friendly pose names and warns about unknown fields", () => {
    const result = convertGenerationScript(script({ mood: "fun", panels: [{ beats: [{ who: "Mia", text: "LOOK!", pose: "point", emotion: "x" }] }] }), catalog);
    expect(result.errors).toEqual([]);
    expect(result.project!.lines[0]).toMatchObject({ studioPose: "point-other" });
    expect(result.warnings).toEqual([
      'Script: ignored "mood" (allowed: format, title, background, font, cast, panels).',
      'Panel 1, beat 1: ignored "emotion" (allowed: who, text, balloon, pose, to, silent).',
    ]);
  });

  it("rejects things that aren't scripts", () => {
    expect(convertGenerationScript("not json", catalog).errors[0]).toMatch(/isn't valid JSON/);
    expect(convertGenerationScript("[1,2]", catalog).errors[0]).toMatch(/one JSON object/);
  });
});

describe("the brief for the assistant", () => {
  it("lists exactly what the site can draw, and its own example is valid", () => {
    const brief = generationBrief(catalog);
    expect(brief).toContain("CHARACTERS: Anna, Dan, Tiki, Anna (color)");
    expect(brief).toContain("BACKGROUNDS: The room, Deep space");
    const example = brief.slice(brief.indexOf("EXAMPLE\n") + 8, brief.lastIndexOf("}") + 1);
    const result = convertGenerationScript(example, catalog);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
