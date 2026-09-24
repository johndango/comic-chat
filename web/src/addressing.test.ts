import { describe, expect, it } from "vitest";
import { addressedText, parseAddressing, withoutAiMarker } from "./addressing";

const room = ["Anna", "Dan", "TongueTiedBot", "johndango"];

describe("directed chat", () => {
  it("prefixes lines with the people you picked", () => {
    expect(addressedText("hi there", ["TongueTiedBot"])).toBe("TongueTiedBot: hi there");
    expect(addressedText("hi both", ["Anna", "Dan"])).toBe("Anna, Dan: hi both");
    expect(addressedText("hi", [])).toBe("hi");
    expect(addressedText("Anna: already said", ["Anna"])).toBe("Anna: already said");
  });

  it("takes the prefix off the balloon and aims the speaker", () => {
    expect(parseAddressing("TongueTiedBot: what is this place?", room)).toEqual({ to: ["TongueTiedBot"], text: "what is this place?" });
    expect(parseAddressing("anna, dan: lunch?", room)).toEqual({ to: ["Anna", "Dan"], text: "lunch?" });
    expect(parseAddressing("@Anna hi", room)).toEqual({ to: [], text: "@Anna hi" });
  });

  it("leaves lines alone when the prefix isn't a room member", () => {
    expect(parseAddressing("Note: lunch at 12", room)).toEqual({ to: [], text: "Note: lunch at 12" });
    expect(parseAddressing("Anna, Stranger: hi", room)).toEqual({ to: [], text: "Anna, Stranger: hi" });
    expect(parseAddressing("just chatting", room)).toEqual({ to: [], text: "just chatting" });
  });

  it("round-trips: what one comic sends, another comic reads back", () => {
    const sent = addressedText("see you soon :)", ["Anna", "Dan"]);
    expect(parseAddressing(sent, room)).toEqual({ to: ["Anna", "Dan"], text: "see you soon :)" });
  });
});

describe("AI marker", () => {
  it("drops [AI] from bots' balloons only", () => {
    expect(withoutAiMarker("TongueTiedBot", "[AI] Hello!")).toBe("Hello!");
    expect(withoutAiMarker("TongueTiedBot_13", "[AI] Hello!")).toBe("Hello!");
    expect(withoutAiMarker("Anna", "[AI] Hello!")).toBe("[AI] Hello!");
    expect(withoutAiMarker("TongueTiedBot", "No marker here")).toBe("No marker here");
  });

  it("works together with addressing on a bot reply", () => {
    expect(parseAddressing(withoutAiMarker("TongueTiedBot", "[AI] Anna: welcome :)"), room)).toEqual({ to: ["Anna"], text: "welcome :)" });
  });
});
