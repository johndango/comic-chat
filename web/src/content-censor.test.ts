import { describe, expect, it } from "vitest";
import { censorComicText, containsCensoredContent } from "./content-censor";

describe("optional comic content censor", () => {
  it("masks profanity, lewd terms, gesture phrases, and named figures", () => {
    expect(censorComicText("What the fuck? Trump gave the middle finger near Jesus."))
      .toBe("What the ***? *** gave the *** near ***.");
    expect(censorComicText("Porn and a Nazi-salute are both filtered."))
      .toBe("*** and a *** are both filtered.");
  });

  it("matches case-insensitively and accepts spaces or hyphens in phrases", () => {
    expect(censorComicText("KIM-JONG-UN and GAUTAMA BUDDHA"))
      .toBe("*** and ***");
  });

  it("does not censor a sensitive sequence embedded in an ordinary word", () => {
    expect(censorComicText("Dickens wrote classics about assumptions and cumulative totals."))
      .toBe("Dickens wrote classics about assumptions and cumulative totals.");
    expect(containsCensoredContent("A completely ordinary sentence.")).toBe(false);
  });
});
