import { describe, expect, it } from "vitest";
import { parseCommunityAvatarCatalog } from "./community-avatars";

describe("community avatar catalog", () => {
  it("accepts curated same-directory avatar metadata", () => {
    expect(parseCommunityAvatarCatalog({
      version: 1,
      avatars: [{
        id: "bikini-girl",
        name: "Bikini Girl",
        announcementName: "Bikini_girl",
        file: "Bikini_girl.AVB",
        creator: "Example Creator",
        sourceUrl: "https://example.com/avatar",
      }],
    }).avatars).toEqual([{
      id: "bikini-girl",
      name: "Bikini Girl",
      announcementName: "Bikini_girl",
      file: "Bikini_girl.AVB",
      creator: "Example Creator",
      sourceUrl: "https://example.com/avatar",
    }]);
  });

  it("rejects paths, unsafe announcements, insecure credits, and duplicates", () => {
    const catalog = parseCommunityAvatarCatalog({ avatars: [
      { id: "one", name: "One", announcementName: "One", file: "one.avb", sourceUrl: "http://example.com" },
      { id: "ONE", name: "Duplicate", announcementName: "Duplicate", file: "duplicate.avb" },
      { id: "path", name: "Path", announcementName: "Path", file: "../path.avb" },
      { id: "spaces", name: "Spaces", announcementName: "Not safe", file: "spaces.avb" },
    ] });
    expect(catalog.avatars).toEqual([{ id: "one", name: "One", announcementName: "One", file: "one.avb" }]);
  });
});
