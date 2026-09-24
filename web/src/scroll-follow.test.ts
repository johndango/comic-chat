import { describe, expect, it } from "vitest";
import { shouldFollowLatest } from "./scroll-follow";

describe("comic auto-follow", () => {
  it("follows while at or close to the bottom", () => {
    expect(shouldFollowLatest({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
    expect(shouldFollowLatest({ scrollTop: 555, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  });

  it("does not pull back a reader who deliberately scrolled upward", () => {
    expect(shouldFollowLatest({ scrollTop: 400, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
  });

  it("follows before the comic is tall enough to scroll", () => {
    expect(shouldFollowLatest({ scrollTop: 0, clientHeight: 500, scrollHeight: 350 })).toBe(true);
  });
});
