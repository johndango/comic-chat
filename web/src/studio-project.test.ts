import { describe, expect, it } from "vitest";
import {
  createStudioProject,
  parseStudioProject,
  studioProjectJson,
} from "./studio-project";

describe("Studio project files", () => {
  const line = {
    kind: "character" as const,
    characterId: "classic:connor.avb",
    characterName: "Connor",
    message: "Hello there",
    mode: "say" as const,
    placement: "current" as const,
    reaction: false,
    studioPose: "wave" as const,
    talkTo: ["Anna"],
  };

  it("round-trips an editable comic script", () => {
    const project = createStudioProject("A test comic", "classic:room.bgb", "comic-sans-ms", [line]);
    expect(parseStudioProject(studioProjectJson(project))).toEqual(project);
  });

  it("does not share mutable audience arrays with the editor", () => {
    const talkTo = ["Anna"];
    const project = createStudioProject("", "classic:room.bgb", "comic-sans-ms", [{ ...line, talkTo }]);
    talkTo.push("Bolo");
    expect(project.lines[0]).toMatchObject({ talkTo: ["Anna"] });
  });

  it("round-trips true empty panels and reads early version-1 character beats", () => {
    const project = createStudioProject("", "classic:room.bgb", "comic-sans-ms", [line, { kind: "blank" }]);
    expect(parseStudioProject(studioProjectJson(project)).lines[1]).toEqual({ kind: "blank" });
    const legacy = JSON.parse(studioProjectJson(project));
    delete legacy.lines[0].kind;
    expect(parseStudioProject(JSON.stringify(legacy)).lines[0]).toMatchObject({ kind: "character" });
  });

  it("rejects unrelated JSON and unsupported versions", () => {
    expect(() => parseStudioProject('{"hello":"world"}')).toThrow("not a WebComicChat");
    expect(() => parseStudioProject('{"format":"webcomicchat-studio","version":2,"title":"","lines":[]}'))
      .toThrow("version 2");
  });

  it("rejects malformed or oversized character beats", () => {
    const project = createStudioProject("", "classic:room.bgb", "comic-sans-ms", [line]);
    expect(() => parseStudioProject(JSON.stringify({ ...project, lines: [{ ...line, mode: "yell" }] })))
      .toThrow("balloon");
    expect(() => parseStudioProject(JSON.stringify({ ...project, lines: [{ ...line, message: "x".repeat(181) }] })))
      .toThrow("dialogue");
    expect(() => parseStudioProject(JSON.stringify({ ...project, lines: [{ ...line, reaction: "sometimes" }] })))
      .toThrow("silent-reaction");
  });
});
