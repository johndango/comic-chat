import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAvatar } from "./avb";
import { emotionFromPoint, emotionName, iconCenters, pointFromEmotion, posesForWheel, stepEmotion, wheelGeometry } from "./emotion-wheel";
import { EM, emotionOfPose, newPoseMemory } from "./expression";

const g = wheelGeometry(159)!;

describe("emotion wheel geometry", () => {
  it("matches bodycam.cpp's sizes", () => {
    expect(g.circleRadius).toBe(79 - 5 - 26);
    expect(g.radius).toBe(g.circleRadius - 5);
    expect(wheelGeometry(80)).toBeNull(); // below MINBULL the wheel is disabled
  });

  it("has a neutral detent in the centre", () => {
    expect(emotionFromPoint(g, g.center.x + g.radius * 0.1, g.center.y)).toEqual({ emotion: 0, intensity: 0 });
    expect(emotionName(emotionFromPoint(g, g.center.x + 3, g.center.y))).toBe("Neutral");
  });

  it("maps directions to the eight emotions clockwise from Happy", () => {
    const at = (angle: number) => emotionName(emotionFromPoint(g, g.center.x + Math.cos(angle) * g.radius, g.center.y + Math.sin(angle) * g.radius));
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => at((i * Math.PI) / 4))).toEqual([
      "Happy", "Coy", "Bored", "Scared", "Sad", "Angry", "Shout", "Laugh",
    ]);
  });

  it("round-trips points and places icons outside the circle", () => {
    const e = { emotion: 1, intensity: 0.7 };
    const p = pointFromEmotion(g, e);
    const back = emotionFromPoint(g, p.x, p.y);
    expect(back.emotion).toBeCloseTo(1, 1);
    expect(back.intensity).toBeCloseTo(0.7, 1);
    for (const c of iconCenters(g)) expect(Math.hypot(c.x - g.center.x, c.y - g.center.y)).toBeGreaterThan(g.circleRadius);
  });

  it("steps like the arrow keys did", () => {
    let e = { emotion: 0, intensity: 0 };
    e = stepEmotion(e, "ArrowUp");
    expect(e.intensity).toBe(0.5);
    e = stepEmotion(stepEmotion(e, "ArrowUp"), "ArrowUp");
    expect(e.intensity).toBe(1);
    e = stepEmotion(e, "ArrowRight");
    expect(e.emotion).toBeCloseTo(Math.PI / 4);
    e = stepEmotion({ emotion: (3 * Math.PI) / 4, intensity: 1 }, "ArrowRight");
    expect(e.emotion).toBeCloseTo(-Math.PI); // wraps around
  });
});

describe("posesForWheel", () => {
  const load = (file: string) => {
    const bytes = readFileSync(new URL(`../../v2.5-beta-1-modern/comicart/${file}`, import.meta.url));
    return parseAvatar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };

  it("gives a composite character the face nearest the chosen emotion", () => {
    const anna = load("anna.avb");
    const choice = posesForWheel(anna, { emotion: EM.SAD, intensity: 1 }, newPoseMemory());
    if (choice.kind !== "complex") throw new Error("expected composite");
    expect(emotionOfPose(anna.faces[choice.face])).toBe(EM.SAD);
    // Dan has no sad face, so the nearest angle wins (angry and scared tie; the later one is kept).
    const dan = load("dan.avb");
    const danChoice = posesForWheel(dan, { emotion: EM.SAD, intensity: 1 }, newPoseMemory());
    if (danChoice.kind !== "complex") throw new Error("expected composite");
    expect([EM.ANGRY, EM.SCARED]).toContain(emotionOfPose(dan.faces[danChoice.face]));
  });

  it("stays neutral at the centre", () => {
    const connor = load("connor.avb");
    const choice = posesForWheel(connor, { emotion: 0, intensity: 0 }, newPoseMemory());
    if (choice.kind !== "simple") throw new Error("expected simple");
    expect(connor.bodies[choice.body].intensity).toBe(0);
  });
});
