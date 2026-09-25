import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAvatar } from "./avb";
import { parseComicChatAnnotation, poseForAnnotation } from "./cc-annotation";

// IndexToByte: a number plus '0', so 10 is ':' and -1 is '/'.
const b = (...numbers: number[]) => numbers.map((n) => String.fromCharCode(48 + n)).join("");

const load = (file: string) => {
  const bytes = readFileSync(new URL(`../../v2.5-beta-1-modern/comicart/${file}`, import.meta.url));
  return parseAvatar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

describe("parsing Comic Chat annotations", () => {
  it("reads poses, mode and addressees, and strips them from the balloon", () => {
    const line = `(#G${b(1, 12, 10)}E${b(7, 4, 10)}RM${b(1)}TAnna,Dan) look at me!`;
    expect(parseComicChatAnnotation(line)).toEqual({
      gesture: { index: 1, emotion: 12, intensity: 10 },
      expression: { index: 7, emotion: 4, intensity: 10 },
      requested: true,
      mode: "say",
      talkTo: ["Anna", "Dan"],
      text: "look at me!",
    });
  });

  it("reads think and action balloons", () => {
    expect(parseComicChatAnnotation(`(#G${b(0, 9, 0)}E${b(0, 9, 0)}M${b(3)}) hmm`)?.mode).toBe("think");
    expect(parseComicChatAnnotation(`(#G${b(0, 9, 0)}E${b(0, 9, 0)}M${b(5)}) waves`)).toMatchObject({ mode: "action", text: "waves" });
  });

  it("keeps whispers honest", () => {
    const whisper = `(#G${b(0, 9, 0)}E${b(0, 9, 0)}M${b(2)}TAnna) psst`;
    expect(parseComicChatAnnotation(whisper)?.mode).toBe("say");
    expect(parseComicChatAnnotation(whisper, true)?.mode).toBe("whisper");
    expect(parseComicChatAnnotation(`(#G${b(0, 9, 0)}E${b(0, 9, 0)}M${b(1)}) hi`, true)?.mode).toBe("whisper");
  });

  it("leaves ordinary lines alone", () => {
    expect(parseComicChatAnnotation("hello there")).toBeNull();
    expect(parseComicChatAnnotation("(#1 fan) of this channel")).toBeNull();
    expect(parseComicChatAnnotation("(#webcomicchat) is great")).toBeNull();
    // Poses without intensities aren't "cooked"; the original left the text alone too.
    expect(parseComicChatAnnotation(`(#G${b(1)}E${b(2)}) hi`)).toBeNull();
    expect(parseComicChatAnnotation(`(#G${b(1, 12, 10)}E${b(7, 4, 10)}M${b(1)})no space`)).toBeNull();
  });

  it("caps the addressee list like the original", () => {
    const line = `(#G${b(0, 9, 0)}E${b(0, 9, 0)}M${b(1)}Ta,b,c,d,e,f,g) hi`;
    expect(parseComicChatAnnotation(line)?.talkTo).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("choosing the pose", () => {
  const anna = load("anna.avb");
  const connor = load("connor.avb");

  it("uses the sender's exact pose when it's in our copy of their character", () => {
    // Anna has two neutral faces (0 and 2); the index says which one.
    const annotation = parseComicChatAnnotation(`(#G${b(1, 12, 10)}E${b(2, 9, 0)}M${b(1)}) me!`)!;
    expect(poseForAnnotation(anna, annotation)).toEqual({ kind: "complex", face: 2, torso: 1 });
  });

  it("matches by emotion when we draw them as someone else", () => {
    // Anna's scared face (emotion 4) at full intensity is face 7; pointing at self (12) is torso 1.
    const annotation = parseComicChatAnnotation(`(#G${b(4, 12, 10)}E${b(3, 4, 10)}M${b(1)}) me!`)!;
    expect(poseForAnnotation(anna, annotation)).toEqual({ kind: "complex", face: 7, torso: 1 });
  });

  it("gives a one-piece character the body for the face's emotion", () => {
    // Connor's bodies: 6/255 (angry) is body 6.
    const angry = parseComicChatAnnotation(`(#G${b(2, 0, 0)}E${b(0, 6, 10)}M${b(1)}) grr`)!;
    expect(poseForAnnotation(connor, angry)).toEqual({ kind: "simple", body: 6 });
    // Laughing (8) is bodies 2 and 9, both full intensity; the index picks.
    const laugh = parseComicChatAnnotation(`(#G${b(9, 0, 0)}E${b(0, 8, 10)}M${b(1)}) haha`)!;
    expect(poseForAnnotation(connor, laugh)).toEqual({ kind: "simple", body: 9 });
  });

  it("returns nothing when no pose fits, so the text rules decide", () => {
    const annotation = parseComicChatAnnotation(`(#G${b(-1, 16, 10)}E${b(-1, 17, 10)}M${b(1)}) ?`)!;
    expect(poseForAnnotation(anna, annotation)).toBeNull();
  });
});
