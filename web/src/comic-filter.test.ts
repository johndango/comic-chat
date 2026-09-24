import { describe, expect, it } from "vitest";
import { visibleComicLines } from "./comic-filter";

const lines = [
  { characterName: "BettyBot", message: "Welcome" },
  { characterName: "Reader", message: "Hello" },
  { characterName: "bettybot", message: "Try help" },
  { characterName: "BettyBotFan", message: "Not the bot" },
];

describe("optional BettyBot comic filter", () => {
  it("keeps every line when the preference is off", () => {
    expect(visibleComicLines(lines, false)).toEqual(lines);
  });

  it("hides only the exact BettyBot nickname, case-insensitively", () => {
    expect(visibleComicLines(lines, true).map((line) => line.characterName)).toEqual(["Reader", "BettyBotFan"]);
  });
});
