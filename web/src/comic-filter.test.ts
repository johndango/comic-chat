import { describe, expect, it } from "vitest";
import { parseHiddenComicBots, visibleComicLines } from "./comic-filter";

const lines = [
  { characterName: "BettyBot", message: "Welcome" },
  { characterName: "Reader", message: "Hello" },
  { characterName: "bettybot", message: "Try help" },
  { characterName: "TongueTiedBot", message: "Hello" },
  { characterName: "n00bBot", message: "LOL" },
  { characterName: "n00bBot_42", message: "Temporary fallback nick" },
  { characterName: "BettyBotFan", message: "Not the bot" },
];

describe("optional bot comic filters", () => {
  it("keeps every line when the preference is off", () => {
    expect(visibleComicLines(lines, new Set())).toEqual(lines);
  });

  it("hides selected exact bot nicknames case-insensitively", () => {
    expect(visibleComicLines(lines, new Set(["bettybot", "n00bbot"])).map((line) => line.characterName))
      .toEqual(["Reader", "TongueTiedBot", "BettyBotFan"]);
  });

  it("loads saved choices safely and migrates the old BettyBot setting", () => {
    expect([...parseHiddenComicBots('["TongueTiedBot","stranger"]', true)].sort())
      .toEqual(["bettybot", "tonguetiedbot"]);
    expect(parseHiddenComicBots("not json").size).toBe(0);
  });
});
