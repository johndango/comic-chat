// Canvas renderer for PanelLayout. Mirrors CUnitPanel::Draw: backdrop, bodies,
// balloons (last to first, so earlier balloons overlap later ones), border.

import type { BalloonGeometry } from "./balloon";
import type { PathCommand, Point } from "./geometry";
import type { BodyLayout, PanelLayout } from "./page";
import type { TitleLayout } from "./title";

export interface RenderAssets {
  backdrop?: CanvasImageSource & { width: number; height: number };
  /** Image for a laid-out body (its pose), or undefined to skip it. */
  body(body: BodyLayout): CanvasImageSource | undefined;
}

export interface RenderOptions {
  /** Output pixels per twip; 1/15 is 96 dpi. */
  scale: number;
  fontFamily?: string;
  pointSize?: number;
  /** Font ascent in em, used to turn TA_TOP anchors into baselines. */
  ascentEm?: number;
}

// balloon.cpp pens
const PEN = 28;
const NIMBUS = 100;
const DASH = [100, 100];

export function drawPanel(
  context: CanvasRenderingContext2D,
  layout: PanelLayout,
  assets: RenderAssets,
  options: RenderOptions,
): void {
  const s = options.scale;
  const X = (x: number): number => x * s;
  const Y = (y: number): number => -y * s;
  const W = layout.width * s;
  const H = layout.height * s;

  context.save();
  context.beginPath();
  context.rect(0, 0, W, H);
  context.clip();

  context.fillStyle = "#fff";
  context.fillRect(0, 0, W, H);
  if (assets.backdrop) {
    const b = assets.backdrop;
    const c = layout.backdropCrop;
    context.drawImage(b, c.x * b.width, c.y * b.height, c.width * b.width, c.height * b.height, 0, 0, W, H);
  }

  for (const body of layout.bodies) {
    const image = assets.body(body);
    if (!image) continue;
    const left = X(body.bbox.left);
    const top = Y(body.bbox.top);
    const width = X(body.bbox.right) - left;
    const height = Y(body.bbox.bottom) - top;
    context.save();
    if (body.flip) {
      context.translate(left + width, top);
      context.scale(-1, 1);
      context.drawImage(image, 0, 0, width, height);
    } else {
      context.drawImage(image, left, top, width, height);
    }
    context.restore();
  }

  for (let i = layout.balloons.length - 1; i >= 0; i -= 1) {
    drawBalloon(context, layout.balloons[i], X, Y, s, options);
  }

  if (layout.border) {
    context.lineWidth = 2 * layout.borderWidth * s;
    context.strokeStyle = "#000";
    context.strokeRect(0, 0, W, H);
  }
  context.restore();
}

function tracePath(context: CanvasRenderingContext2D, path: PathCommand[], P: (p: Point) => [number, number]): void {
  context.beginPath();
  for (const c of path) {
    if (c.op === "move") context.moveTo(...P(c.to));
    else if (c.op === "line") context.lineTo(...P(c.to));
    else if (c.op === "bezier") context.bezierCurveTo(...P(c.c1), ...P(c.c2), ...P(c.to));
    else context.closePath();
  }
}

function drawBalloon(
  context: CanvasRenderingContext2D,
  balloon: BalloonGeometry,
  X: (x: number) => number,
  Y: (y: number) => number,
  s: number,
  options: RenderOptions,
): void {
  const P = (p: Point): [number, number] => [X(p.x), Y(p.y)];
  context.save();
  context.lineJoin = "round";
  tracePath(context, balloon.path, P);
  context.fillStyle = "#fff";
  if (balloon.dashed) {
    // Whisper: a thick white nimbus, then a dashed black outline on top.
    context.strokeStyle = "#fff";
    context.lineWidth = NIMBUS * s;
    context.stroke();
    context.fill();
    context.setLineDash(DASH.map((d) => d * s));
    context.strokeStyle = "#000";
    context.lineWidth = PEN * s;
    context.stroke();
    context.setLineDash([]);
  } else {
    // GDI StrokeAndFillPath paints the pen over the fill.
    context.fill();
    context.strokeStyle = "#000";
    context.lineWidth = PEN * s;
    context.stroke();
  }

  for (const bubble of balloon.thinkBubbles) {
    const r = bubble.rect;
    context.beginPath();
    context.ellipse(
      X((r.left + r.right) / 2),
      Y((r.top + r.bottom) / 2),
      X((r.right - r.left) / 2),
      X((r.top - r.bottom) / 2),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
  }

  const pointSize = options.pointSize ?? 12;
  const em = pointSize * 20 * s;
  const italic = balloon.mode === "whisper" ? "italic " : "";
  context.font = `${italic}${em}px ${options.fontFamily ?? '"Comic Sans MS", "Comic Neue", cursive'}`;
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  const ascent = (options.ascentEm ?? 1.102) * em;
  for (const line of balloon.lines) context.fillText(line.text, X(line.x), Y(line.y) + ascent);
  if (balloon.links.length > 0) {
    context.beginPath();
    context.lineWidth = Math.max(1, s * 12);
    for (const link of balloon.links) {
      for (const box of link.boxes) {
        const underlineY = Y(box.top) + box.height * s * 0.92;
        context.moveTo(X(box.left), underlineY);
        context.lineTo(X(box.left + box.width), underlineY);
      }
    }
    context.strokeStyle = "#000";
    context.stroke();
  }
  context.restore();
}

/** Canvas-backed text measurement in twips, for balloonFontMetrics(). */
export function canvasMeasurer(
  context: CanvasRenderingContext2D,
  options: { pointSize?: number; italic?: boolean; fontFamily?: string } = {},
): (text: string) => number {
  const em = (options.pointSize ?? 12) * 20;
  const font = `${options.italic ? "italic " : ""}${em}px ${options.fontFamily ?? '"Comic Sans MS", "Comic Neue", cursive'}`;
  const cache = new Map<string, number>();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      context.save();
      context.font = font;
      width = context.measureText(text).width;
      context.restore();
      cache.set(text, width);
    }
    return width;
  };
}

/** Draw the title panel (no border, no backdrop, as in AddTitle). */
export function drawTitlePanel(
  context: CanvasRenderingContext2D,
  layout: TitleLayout,
  icon: (id: string) => CanvasImageSource | undefined,
  options: RenderOptions,
): void {
  const s = options.scale;
  const family = options.fontFamily ?? '"Comic Sans MS", "Comic Neue", cursive';
  const ascentEm = options.ascentEm ?? 1.102;
  context.save();
  context.fillStyle = "#fff";
  context.fillRect(0, 0, layout.width * s, layout.height * s);
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  for (const label of layout.labels) {
    const size = label.heightTwips * s;
    context.font = `${size}px ${family}`;
    let text = label.text;
    if (label.maxWidth !== undefined) {
      // DT_END_ELLIPSIS
      const max = label.maxWidth * s;
      while (text.length > 1 && context.measureText(text).width > max) text = text.slice(0, -2) + "…";
    }
    context.fillText(text, label.x * s, -label.y * s + ascentEm * size);
  }
  for (const { id, rect } of layout.icons) {
    const image = icon(id);
    if (image) context.drawImage(image, rect.left * s, -rect.top * s, (rect.right - rect.left) * s, (rect.top - rect.bottom) * s);
  }
  context.restore();
}
