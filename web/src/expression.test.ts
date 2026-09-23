import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAvatar } from "./avb";
import { choosePoses, EM, emotionOfPose, emotionOptions, newPoseMemory } from "./expression";

const art = new URL("../../v2.5-beta-1-modern/comicart/", import.meta.url);
function avatar(file: string) {
  const bytes = readFileSync(new URL(file, art));
  return parseAvatar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const top = (text: string, everySentence = false) =>
  emotionOptions(text, { everySentence })
    .sort((a, b) => b.priority - a.priority)
    .map((o) => [o.emotion, o.priority]);

describe("emotionOptions (textpose.cpp rules)", () => {
  it("keeps every matching emotion with its rule strength", () => {
    expect(top("Hi everyone :)")).toEqual([
      [EM.HAPPY, 10],
      [EM.WAVE, 2],
    ]);
  });

  it("shouts on all caps with more than one capital, or on !!!", () => {
    expect(top("WHAT")).toEqual([[EM.SHOUT, 9]]);
    expect(top("I")).toEqual([[EM.POINTSELF, 3]]); // one capital is not a shout
    expect(top("really!!!")).toEqual([[EM.SHOUT, 9]]);
  });

  it("matches words only at word boundaries", () => {
    expect(top("lol that's funny")[0]).toEqual([EM.LAUGH, 11]);
    expect(top("lollipop")).toEqual([]);
    expect(top("hehehe")[0]).toEqual([EM.LAUGH, 11]); // FindString is a plain substring
  });

  it("uses the strongest rule when one emotion matches twice", () => {
    expect(top("I am here")).toEqual([[EM.POINTSELF, 7]]);
  });

  it("only checks the first sentence's start, like the shipped client", () => {
    expect(top("Well. Hello there")).toEqual([]);
    expect(top("Well. Hello there", true)).toEqual([[EM.WAVE, 5]]);
  });

  it("treats any non-alphanumeric character as ending a sentence-start word", () => {
    expect(top("I'm back")).toEqual([[EM.POINTSELF, 7]]);
    expect(top("Hilarious")).toEqual([]);
  });
});

describe("choosePoses", () => {
  it("gives a composite character a gesture torso and an expressive face together", () => {
    const anna = avatar("anna.avb");
    const choice = choosePoses(anna, emotionOptions("Hi everyone :)"));
    if (choice.kind !== "complex") throw new Error("expected a composite avatar");
    expect(emotionOfPose(anna.torsos[choice.torso])).toBe(EM.WAVE);
    const face = anna.faces[choice.face];
    expect(emotionOfPose(face)).toBe(EM.HAPPY);
    expect(face.intensity).toBeGreaterThan(0);
  });

  it("rotates through neutral poses when nothing matches", () => {
    const anna = avatar("anna.avb");
    const memory = newPoseMemory();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const choice = choosePoses(anna, [], memory);
      if (choice.kind === "complex") seen.add(`${choice.face}:${choice.torso}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("picks a single pose for simple avatars", () => {
    const connor = avatar("connor.avb");
    const choice = choosePoses(connor, emotionOptions("LOL"));
    expect(choice.kind).toBe("simple");
    if (choice.kind === "simple") expect(emotionOfPose(connor.bodies[choice.body])).toBe(EM.LAUGH);
  });
});
