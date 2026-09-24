import { describe, expect, it } from "vitest";
import {
  avatarRuleKey,
  ircNicknameKey,
  parseAvatarAnnouncement,
  parseAvatarDisplayPolicy,
  preferAvatarEdition,
  resolveAvatarFile,
} from "./avatar-policy";

const official = new Set(["anna.avb", "connor.avb"]);

describe("avatar display policy", () => {
  it("uses IRC case folding for persistent member rules", () => {
    expect(ircNicknameKey("[Comic]\\^ ")).toBe("{comic}|~");
    expect(avatarRuleKey("Libera", "SomeNick")).toBe("libera:somenick");
  });

  it("defaults safely and discards unknown forced files", () => {
    expect(parseAvatarDisplayPolicy(null, official)).toEqual({ officialOnly: true, artPreference: "none", forced: {} });
    expect(parseAvatarDisplayPolicy(JSON.stringify({
      officialOnly: false,
      artPreference: "color",
      forced: { "libera:alice": "anna.avb", "libera:bob": "stranger.avb" },
    }), official)).toEqual({ officialOnly: false, artPreference: "color", forced: { "libera:alice": "anna.avb" } });
  });

  it("swaps paired editions while leaving unpaired art alone", () => {
    const pair = { monochrome: "anna.avb", color: "anna-color.avb" };
    const editions = new Map([[pair.monochrome, pair], [pair.color, pair]]);
    expect(preferAvatarEdition(pair.monochrome, "color", editions)).toBe(pair.color);
    expect(preferAvatarEdition(pair.color, "monochrome", editions)).toBe(pair.monochrome);
    expect(preferAvatarEdition(pair.color, "none", editions)).toBe(pair.color);
    expect(preferAvatarEdition("custom.avb", "color", editions)).toBe("custom.avb");
  });

  it("does not override an explicit forced mapping with an art preference", () => {
    const pair = { monochrome: "anna.avb", color: "anna-color.avb" };
    const editions = new Map([[pair.monochrome, pair], [pair.color, pair]]);
    expect(resolveAvatarFile({
      network: "libera",
      nickname: "Alice",
      forced: { "libera:alice": pair.monochrome },
      announcedOfficialFile: pair.color,
      artPreference: "color",
      editions,
      fallbackFile: pair.color,
    })).toBe(pair.monochrome);
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

  it("uses validated custom art only when official-only mode is off", () => {
    const common = {
      network: "libera",
      nickname: "Alice",
      forced: {},
      announcedCustomFile: "https://webcomicchat.com/avatars/alice.avb",
      fallbackFile: "connor.avb",
    };
    expect(resolveAvatarFile({ ...common, officialOnly: true })).toBe("connor.avb");
    expect(resolveAvatarFile({ ...common, officialOnly: false })).toBe("https://webcomicchat.com/avatars/alice.avb");
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
