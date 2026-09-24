import { describe, expect, it } from "vitest";
import {
  avatarRuleKey,
  ircNicknameKey,
  parseAvatarAnnouncement,
  parseAvatarDisplayPolicy,
  resolveAvatarFile,
} from "./avatar-policy";

const official = new Set(["anna.avb", "connor.avb"]);

describe("avatar display policy", () => {
  it("uses IRC case folding for persistent member rules", () => {
    expect(ircNicknameKey("[Comic]\\^ ")).toBe("{comic}|~");
    expect(avatarRuleKey("Libera", "SomeNick")).toBe("libera:somenick");
  });

  it("defaults safely and discards unknown forced files", () => {
    expect(parseAvatarDisplayPolicy(null, official)).toEqual({ officialOnly: true, forced: {} });
    expect(parseAvatarDisplayPolicy(JSON.stringify({
      officialOnly: false,
      forced: { "libera:alice": "anna.avb", "libera:bob": "stranger.avb" },
    }), official)).toEqual({ officialOnly: false, forced: { "libera:alice": "anna.avb" } });
  });

  it("gives a forced mapping precedence over an announced avatar", () => {
    expect(resolveAvatarFile({
      network: "libera",
      nickname: "Alice",
      forced: { "libera:alice": "anna.avb" },
      announcedOfficialFile: "connor.avb",
      fallbackFile: "connor.avb",
    })).toBe("anna.avb");
  });

  it("recognizes the original Appears as annotation without retaining insecure URLs", () => {
    expect(parseAvatarAnnouncement("# Appears as Connor")).toEqual({ name: "Connor" });
    expect(parseAvatarAnnouncement("# Appears as Pip.https://webcomicchat.com/art/pip.avb")).toEqual({
      name: "Pip",
      url: "https://webcomicchat.com/art/pip.avb",
    });
    expect(parseAvatarAnnouncement("# Appears as Pip.http://example.com/pip.avb")).toEqual({ name: "Pip" });
    expect(parseAvatarAnnouncement("hello")).toBeUndefined();
  });
});
