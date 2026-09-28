import { describe, expect, it } from "vitest";
import { comicPngFilename, comicShareTitle, pngDataUrlFile, redditComicSubmitUrl } from "./comic-share";

describe("comic sharing", () => {
  it("uses a Studio title or describes a selected set", () => {
    expect(comicShareTitle("  My Strip  ", undefined)).toBe("My Strip");
    expect(comicShareTitle("", 1)).toBe("A favorite WebComicChat panel");
    expect(comicShareTitle("", 4)).toBe("4 favorite WebComicChat panels");
    expect(comicShareTitle("", undefined)).toBe("A comic made with WebComicChat");
  });

  it("makes deterministic strip and selection filenames", () => {
    expect(comicPngFilename(false, 123)).toBe("comic-chat-strip-123.png");
    expect(comicPngFilename(true, 456)).toBe("comic-chat-selection-456.png");
  });

  it("turns a PNG data URL into a named shareable file", async () => {
    const file = pngDataUrlFile("data:image/png;base64,iVBORw0KGgo=", "comic.png");
    expect(file.name).toBe("comic.png");
    expect(file.type).toBe("image/png");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(() => pngDataUrlFile("data:text/plain;base64,aGk=", "bad.png")).toThrow(/could not be prepared/);
  });

  it("opens the subreddit composer with a suggested title", () => {
    const url = new URL(redditComicSubmitUrl("A comic & more"));
    expect(url.pathname).toBe("/r/webcomicchat_comics/submit");
    expect(url.searchParams.get("title")).toBe("A comic & more");
  });
});
