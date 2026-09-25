import { describe, expect, it } from "vitest";
import { describePanel, transcriptLine } from "./panel-text";

describe("panel descriptions", () => {
  it("says who says what, in order", () => {
    const text = describePanel(
      1,
      [
        { speakerId: "Anna", mode: "say", text: "HI\nEVERYBODY!" },
        { speakerId: "Dan", mode: "think", text: "WHO'S THAT?" },
      ],
      [{ id: "Anna" }, { id: "Dan" }, { id: "Tiki" }],
    );
    expect(text).toBe("Panel 2. Anna says: HI EVERYBODY! Dan thinks: WHO'S THAT? Also in the panel: Tiki.");
  });

  it("handles captions and empty panels", () => {
    expect(describePanel(0, [{ speakerId: "Anna", mode: "action", text: "WAVES" }], [{ id: "Anna" }])).toBe("Panel 1. Anna WAVES.");
    expect(describePanel(2, [], [{ id: "Dan" }])).toBe("Panel 3. No one speaks. Also in the panel: Dan.");
  });
});

describe("plain text lines", () => {
  const base = { characterName: "Anna", message: "hello", talkTo: [] as string[] };
  it("reads like an IRC client", () => {
    expect(transcriptLine({ ...base, mode: "say" })).toBe("Anna: hello");
    expect(transcriptLine({ ...base, mode: "say", talkTo: ["Dan"] })).toBe("Anna (to Dan): hello");
    expect(transcriptLine({ ...base, mode: "think" })).toBe("Anna thinks: hello");
    expect(transcriptLine({ ...base, mode: "whisper", talkTo: ["Dan", "Tiki"] })).toBe("Anna whispers to Dan, Tiki: hello");
    expect(transcriptLine({ ...base, mode: "action", message: "waves" })).toBe("* Anna waves");
    expect(transcriptLine({ ...base, mode: "say", reaction: true })).toBe("Anna appears.");
  });
});
