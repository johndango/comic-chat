import { describe, expect, it } from "vitest";
import { MsvcRand } from "./rand";
import { layoutTitlePanel, orderStars, randomTitle, TITLES } from "./title";

const fonts = { measure: (text: string, h: number) => text.length * h * 0.55 };

describe("title panel", () => {
  it("draws its title from the 16 shipped titles", () => {
    const rng = new MsvcRand(1);
    const seen = new Set(Array.from({ length: 200 }, () => randomTitle(rng)));
    expect(TITLES).toHaveLength(16);
    for (const title of seen) expect(TITLES).toContain(title);
    expect(seen.size).toBeGreaterThan(10);
  });

  it("orders stars: you first, then by messages sent, departed last", () => {
    const order = orderStars([
      { id: "a", nickname: "a", sends: 1 },
      { id: "b", nickname: "b", sends: 9, departed: true },
      { id: "me", nickname: "me", sends: 0, self: true },
      { id: "c", nickname: "c", sends: 5 },
    ]).map((s) => s.id);
    expect(order).toEqual(["me", "c", "a", "b"]);
  });

  it("stacks title, STARRING and one icon row per star down the panel", () => {
    const stars = ["Anna", "Dan", "Kirby"].map((n, i) => ({ id: n, nickname: n, sends: 3 - i }));
    const layout = layoutTitlePanel("Born to chat", stars, fonts);
    expect(layout.labels[0].text).toBe("BORN TO CHAT");
    const starring = layout.labels.find((l) => l.text === "STARRING")!;
    expect(starring.y).toBeLessThan(layout.labels[0].y);
    expect(layout.icons.map((i) => i.id)).toEqual(["Anna", "Dan", "Kirby"]);
    for (let i = 1; i < layout.icons.length; i += 1) {
      expect(layout.icons[i].rect.top).toBeLessThanOrEqual(layout.icons[i - 1].rect.bottom);
    }
    expect(layout.icons.at(-1)!.rect.bottom).toBeGreaterThanOrEqual(-layout.height);
  });

  it("shows only as many stars as fit", () => {
    const stars = Array.from({ length: 40 }, (_, i) => ({ id: `u${i}`, nickname: `user${i}`, sends: i }));
    const layout = layoutTitlePanel("No exit", stars, fonts);
    expect(layout.icons.length).toBeLessThan(40);
    expect(layout.icons.at(-1)!.rect.bottom).toBeGreaterThanOrEqual(-layout.height);
  });
});
