import { describe, expect, it } from "vitest";
import { MessageLinkFilter } from "./link-filter";

describe("MessageLinkFilter", () => {
  it("combines built-in and configured host rules", () => {
    const filter = new MessageLinkFilter("spam.example", "https://unused.invalid");
    expect(filter.check("https://iplogger.org/abc")).toEqual({ hostname: "iplogger.org", source: "built-in" });
    expect(filter.check("https://sub.spam.example/a")).toEqual({ hostname: "sub.spam.example", source: "built-in" });
  });

  it("matches exact OpenPhish URLs without condemning the whole host", () => {
    const filter = new MessageLinkFilter("", "https://unused.invalid");
    expect(filter.loadOpenPhishText("https://example.com/stolen-login#fragment\nnot a URL\n")).toBe(1);
    expect(filter.check("avoid https://example.com/stolen-login#other")).toEqual({ hostname: "example.com", source: "openphish" });
    expect(filter.check("safe https://example.com/ordinary")).toBeUndefined();
  });
});
