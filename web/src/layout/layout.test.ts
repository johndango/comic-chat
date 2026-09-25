import { describe, expect, it } from "vitest";
import { balloonFontMetrics, breakIntoLines, type BalloonFonts } from "./balloon";
import { arcPath, BetaSpline, type PathCommand, type Point } from "./geometry";
import { ComicPage, type PoseSize } from "./page";
import { MsvcRand } from "./rand";

// Monospace stand-in for 12pt Comic Sans capitals: ~0.55 em per character.
const measure = (text: string): number => text.length * 132;
const font = balloonFontMetrics(measure);
const fonts: BalloonFonts = { normal: font, whisper: font };
const pose: PoseSize = { width: 120, height: 200, faceX: 80 };

function endPoints(path: PathCommand[]): Point[] {
  return path.flatMap((c) => (c.op === "close" ? [] : [c.to]));
}

describe("MsvcRand", () => {
  it("reproduces the MSVC C runtime sequence", () => {
    const rng = new MsvcRand(1);
    expect([rng.rand(), rng.rand(), rng.rand(), rng.rand()]).toEqual([41, 18467, 6334, 26500]);
  });
});

describe("font metrics", () => {
  it("applies the Comic Sans vertical kerning from fonts.cpp", () => {
    expect(font.lineHeight).toBe(font.textHeight - 53);
    expect(font.baseAdd).toBe(40);
  });
});

describe("breakIntoLines", () => {
  it("wraps greedily at word boundaries", () => {
    const lines = breakIntoLines(font, 132 * 11, "HELLO THERE GENERAL KENOBI");
    expect(lines.map((l) => "HELLO THERE GENERAL KENOBI".slice(l.start, l.start + l.length))).toEqual([
      "HELLO THERE",
      "GENERAL",
      "KENOBI",
    ]);
  });

  it("honours explicit newlines", () => {
    const text = "HI\nTHERE";
    const lines = breakIntoLines(font, 10_000, text);
    expect(lines.map((l) => text.slice(l.start, l.start + l.length))).toEqual(["HI", "THERE"]);
  });

  it("breaks a word that cannot fit on any line", () => {
    const text = "SUPERCALIFRAGILISTIC";
    const lines = breakIntoLines(font, 132 * 8, text);
    expect(lines[0].length).toBe(8);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("geometry", () => {
  it("a closed beta spline returns to its start", () => {
    const spline = new BetaSpline(
      [
        { x: 0, y: 0 },
        { x: 0, y: -500 },
        { x: 800, y: -500 },
        { x: 800, y: 0 },
      ],
      true,
    );
    const first = spline.bezpts[0];
    const last = spline.bezpts[spline.bezpts.length - 1];
    expect(last.x).toBeCloseTo(first.x, 6);
    expect(last.y).toBeCloseTo(first.y, 6);
  });

  it("an open beta spline interpolates its end points", () => {
    const spline = new BetaSpline(
      [
        { x: 0, y: 0 },
        { x: 300, y: 400 },
        { x: 600, y: 0 },
      ],
      false,
    );
    expect(spline.bezpts[0]).toEqual({ x: 0, y: 0 });
    const last = spline.bezpts[spline.bezpts.length - 1];
    expect(last.x).toBeCloseTo(600, 6);
    expect(last.y).toBeCloseTo(0, 6);
  });

  it("arcs end exactly where they are asked to", () => {
    const path = arcPath({ x: 0, y: 0 }, { x: 0, y: -1000 }, 50);
    const end = endPoints(path).at(-1)!;
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(-1000, 6);
  });
});

describe("ComicPage", () => {
  it("lays out deterministically for the same seed", () => {
    const run = () => {
      const page = new ComicPage({ fonts, seed: 7 });
      page.addLine({ speakerId: "anna", text: "Hi everyone, how is it going?", pose });
      page.addLine({ speakerId: "dan", text: "Pretty good!", pose });
      return JSON.stringify(page.layouts);
    };
    expect(run()).toBe(run());
  });

  it("upper-cases balloon text and keeps it inside the balloon area", () => {
    const page = new ComicPage({ fonts, seed: 3 });
    page.addLine({ speakerId: "anna", text: "hello there", pose });
    const [panel] = page.layouts;
    const [balloon] = panel.balloons;
    expect(balloon.text).toBe("HELLO THERE");
    expect(balloon.cloudBox.left).toBeGreaterThanOrEqual(60);
    expect(balloon.cloudBox.right).toBeLessThanOrEqual(panel.width - 60);
    // The wavy control points may poke into the border (Dock() allows for the
    // 70-twip wave height); the text itself starts below the free area's top.
    expect(balloon.lines[0].y).toBeLessThanOrEqual(-60);
  });

  it("lays out public link hitboxes but never makes whisper text clickable", () => {
    const text = "go https://Example.com/A now";
    const link = { href: "https://example.com/A", hostname: "example.com", start: 3, end: 24 };
    const publicPage = new ComicPage({ fonts, seed: 3 });
    publicPage.addLine({ speakerId: "anna", text, pose, links: [link] });
    expect(publicPage.layouts[0].balloons[0].links[0]).toMatchObject({ href: link.href, hostname: link.hostname });
    expect(publicPage.layouts[0].balloons[0].links[0].boxes.length).toBeGreaterThan(0);

    const whisperPage = new ComicPage({ fonts, seed: 3 });
    whisperPage.addLine({ speakerId: "anna", text, mode: "whisper", pose, links: [link] });
    expect(whisperPage.layouts[0].balloons[0].links).toEqual([]);
  });

  it("aims the tail at the speaker's face", () => {
    const page = new ComicPage({ fonts, seed: 11 });
    page.addLine({ speakerId: "anna", text: "Look at me", pose });
    const [panel] = page.layouts;
    const body = panel.bodies[0];
    const points = endPoints(panel.balloons[0].path);
    const tip = points.reduce((low, p) => (p.y < low.y ? p : low));
    expect(tip.x).toBeCloseTo(body.arrowX, 0);
    expect(tip.y).toBeLessThan(panel.balloons[0].cloudBox.bottom);
  });

  it("adds a new speaker to the current panel, reading left to right then down", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "First", pose });
    page.addLine({ speakerId: "dan", text: "Second", pose });
    expect(page.layouts).toHaveLength(1);
    const [first, second] = page.layouts[0].balloons;
    // Either the second sits entirely to the right at or below the first's top, or below it.
    const beside = second.cloudBox.left > first.cloudBox.right && second.cloudBox.top <= first.cloudBox.top;
    const below = second.cloudBox.top <= first.cloudBox.bottom + 90;
    expect(beside || below).toBe(true);
  });

  it("starts a new panel when the same character speaks again", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addLine({ speakerId: "anna", text: "Two", pose });
    expect(page.layouts).toHaveLength(2);
  });

  it("lets the Studio explicitly keep another beat in the current panel", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addLine({ speakerId: "anna", text: "Two", pose, stayInPanel: true });
    expect(page.layouts).toHaveLength(1);
    expect(page.layouts[0].balloons.map((balloon) => balloon.text)).toEqual(["ONE", "TWO"]);
  });

  it("honors the original hidden break command on the next line", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addLine({ speakerId: "dan", text: "Two", pose, breakBefore: true });
    expect(page.layouts).toHaveLength(2);
    expect(page.layouts.map((panel) => panel.balloons.length)).toEqual([1, 1]);
  });

  it("adds a reaction character without a speech balloon", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addLine({ speakerId: "dan", text: "", pose, reaction: true });
    const reactionPanel = page.layouts.at(-1)!;
    expect(reactionPanel.bodies.some((body) => body.id === "dan")).toBe(true);
    expect(reactionPanel.balloons).toHaveLength(0);
  });

  it("lets the Studio add a silent character to the current panel", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addLine({ speakerId: "dan", text: "", pose, reaction: true, stayInPanel: true });
    expect(page.layouts).toHaveLength(1);
    expect(page.layouts[0].bodies.map((body) => body.id)).toEqual(expect.arrayContaining(["anna", "dan"]));
    expect(page.layouts[0].balloons).toHaveLength(1);
  });

  it("adds a true empty pacing panel without inventing a cast member", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addBlankPanel();
    page.addLine({ speakerId: "dan", text: "Three", pose });
    expect(page.layouts).toHaveLength(3);
    expect(page.layouts[1].bodies).toEqual([]);
    expect(page.layouts[1].balloons).toEqual([]);
    expect(page.layouts[2].balloons[0].text).toBe("THREE");
  });

  it("preserves an empty pacing panel when the next beat requests the current panel", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addBlankPanel();
    page.addLine({ speakerId: "anna", text: "After the pause", pose, stayInPanel: true });
    expect(page.layouts).toHaveLength(2);
    expect(page.layouts[0].bodies).toEqual([]);
    expect(page.layouts[1].balloons[0].text).toBe("AFTER THE PAUSE");
  });

  it("never zooms the establishing panel but may zoom later ones", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "One", pose });
    page.addLine({ speakerId: "anna", text: "Two", pose });
    const [first, second] = page.layouts;
    expect(first.establishing).toBe(true);
    expect(first.zoom).toBe(1);
    expect(second.establishing).toBe(false);
    expect(second.zoom).toBeGreaterThan(1.1);
    expect(second.backdropCrop.width).toBeCloseTo(1 / second.zoom, 2);
  });

  it("gives action text its own boxed panel", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "Hi", pose });
    page.addLine({ speakerId: "dan", text: "waves", mode: "action", pose });
    expect(page.layouts).toHaveLength(2);
    const box = page.layouts[1].balloons[0];
    expect(box.mode).toBe("action");
    expect(box.path.filter((c) => c.op === "line")).toHaveLength(3);
  });

  it("draws thought bubbles instead of a tail", () => {
    const page = new ComicPage({ fonts, seed: 5 });
    page.addLine({ speakerId: "anna", text: "hmm", mode: "think", pose });
    const balloon = page.layouts[0].balloons[0];
    expect(balloon.thinkBubbles.length).toBeGreaterThan(0);
    const widths = balloon.thinkBubbles.map((b) => b.rect.right - b.rect.left);
    expect(widths[widths.length - 1]).toBeGreaterThanOrEqual(widths[0]);
  });

  it("spills very long text into continuation panels", () => {
    const page = new ComicPage({ fonts, seed: 5, unitWidth: 2300 });
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    page.addLine({ speakerId: "anna", text, pose });
    const texts = page.layouts.map((p) => p.balloons[0].text);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts[0].endsWith("...")).toBe(true);
    expect(texts[1].startsWith("...")).toBe(true);
  });

  it("preserves a long link destination when its text spills across panels", () => {
    const page = new ComicPage({ fonts, seed: 5, unitWidth: 2300 });
    const href = `https://example.com/${"long-path/".repeat(18)}`;
    page.addLine({
      speakerId: "anna",
      text: href,
      pose,
      links: [{ href, hostname: "example.com", start: 0, end: href.length }],
    });
    const links = page.layouts.flatMap((panel) => panel.balloons.flatMap((balloon) => balloon.links));
    expect(page.layouts.length).toBeGreaterThan(1);
    expect(links.length).toBeGreaterThan(1);
    expect(links.every((link) => link.href === href && link.boxes.length > 0)).toBe(true);
  });

  it("caps a panel at five balloons", () => {
    const page = new ComicPage({ fonts, seed: 5, unitWidth: 9000 });
    for (const id of ["a", "b", "c", "d", "e", "f"]) page.addLine({ speakerId: id, text: "Yo", pose });
    expect(page.layouts[0].balloons.length).toBeLessThanOrEqual(5);
    expect(page.layouts.length).toBeGreaterThan(1);
  });

  it("turns speakers toward the person they address and pulls listeners in", () => {
    const page = new ComicPage({
      fonts,
      seed: 5,
      talkTos: (id) => (id === "anna" ? ["dan"] : []),
      neutralPose: () => ({ pose }),
    });
    page.addLine({ speakerId: "anna", text: "Dan, come here", pose });
    const bodies = page.layouts[0].bodies;
    expect(bodies.map((b) => b.id).sort()).toEqual(["anna", "dan"]);
    const anna = bodies.find((b) => b.id === "anna")!;
    const dan = bodies.find((b) => b.id === "dan")!;
    expect(dan.listener).toBe(true);
    const annaFacesRight = !anna.flip;
    expect(annaFacesRight).toBe(anna.bbox.left < dan.bbox.left);
  });
});
