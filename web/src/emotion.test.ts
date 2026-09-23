import { describe, expect, it } from "vitest";
import type { PoseDescriptor } from "./avb";
import { analyzeMessage, selectPose } from "./emotion";

describe("Comic Chat expression rules", () => {
  it.each([
    ["HELLO THERE!!!", "shout"],
    ["LOL", "laugh"],
    ["Nice to see you :-)", "happy"],
    ["Well, that's rough :(", "sad"],
    ["Okay then ;)", "coy"],
    ["Howdy, stranger", "wave"],
    ["Are you coming?", "point-other"],
    ["I'm on my way", "point-self"],
    ["A regular sentence.", "neutral"],
  ])("maps %s to %s", (message, expected) => {
    expect(analyzeMessage(message).name).toBe(expected);
  });

  it("preserves the original rule priority", () => {
    expect(analyzeMessage("LOL!!!").name).toBe("laugh");
  });

  it("chooses the closest intensity for the requested emotion", () => {
    const pose = (emotion: number, intensity: number) => ({ emotion, intensity }) as PoseDescriptor;
    const poses = [pose(9, 0), pose(8, 80), pose(8, 250)];
    expect(selectPose(poses, analyzeMessage("LOL"))).toBe(2);
    expect(selectPose(poses, analyzeMessage("Just chatting"))).toBe(0);
  });
});
