import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "./slash-commands";

describe("message-box commands", () => {
  it("leaves ordinary lines alone", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("  a/b testing")).toBeNull();
  });

  it("turns /me, /think and /say into balloons", () => {
    expect(parseSlashCommand("/me waves")).toEqual({ kind: "line", mode: "action", text: "waves" });
    expect(parseSlashCommand("/ME   dances wildly ")).toEqual({ kind: "line", mode: "action", text: "dances wildly" });
    expect(parseSlashCommand("/think hmm")).toEqual({ kind: "line", mode: "think", text: "hmm" });
    expect(parseSlashCommand("/say /me is how you act")).toEqual({ kind: "line", mode: "say", text: "/me is how you act" });
    expect(parseSlashCommand("/me")).toMatchObject({ kind: "error" });
  });

  it("sends // lines literally", () => {
    expect(parseSlashCommand("//shrug")).toEqual({ kind: "line", mode: "say", text: "/shrug" });
  });

  it("whispers to one or several people", () => {
    expect(parseSlashCommand("/msg Anna psst, over here")).toEqual({ kind: "whisper", to: ["Anna"], text: "psst, over here" });
    expect(parseSlashCommand("/whisper Anna,Dan,Anna hi")).toEqual({ kind: "whisper", to: ["Anna", "Dan"], text: "hi" });
    expect(parseSlashCommand("/w Anna")).toMatchObject({ kind: "error" });
    expect(parseSlashCommand("/msg #webcomicchat hi")).toMatchObject({ kind: "error" });
    expect(parseSlashCommand("/msg a,b,c,d,e,f hi")).toMatchObject({ kind: "error" });
  });

  it("joins rooms, adding the # if it's missing", () => {
    expect(parseSlashCommand("/join #comics")).toEqual({ kind: "join", channel: "#comics" });
    expect(parseSlashCommand("/j comics")).toEqual({ kind: "join", channel: "#comics" });
    expect(parseSlashCommand("/join")).toMatchObject({ kind: "error" });
  });

  it("knows clear, quit and help, and explains unknown commands", () => {
    expect(parseSlashCommand("/clear")).toEqual({ kind: "clear" });
    expect(parseSlashCommand("/quit bye")).toEqual({ kind: "quit" });
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
    const unknown = parseSlashCommand("/nickserv identify hunter2");
    expect(unknown).toMatchObject({ kind: "error" });
    // Never echo what followed an unknown command (it may be a password).
    expect(JSON.stringify(unknown)).not.toContain("hunter2");
  });
});
