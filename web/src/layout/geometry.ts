// Curve math ported from spline.cpp, splinutl.cpp and arc.cpp.
//
// All layout coordinates use the original MM_TWIPS convention: x grows to the
// right, y grows *upward*, a panel's top edge is y = 0 and its bottom edge is
// y = -unitHeight.

export interface Point {
  x: number;
  y: number;
}

export type Matrix = number[][];

/** A path segment in absolute coordinates, ready for Canvas/SVG. */
export type PathCommand =
  | { op: "move"; to: Point }
  | { op: "line"; to: Point }
  | { op: "bezier"; c1: Point; c2: Point; to: Point }
  | { op: "close" };

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (s: number, a: Point): Point => ({ x: s * a.x, y: s * a.y });
export const magnitude = (a: Point): number => Math.hypot(a.x, a.y);
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vectorToAngle = (v: Point): number =>
  Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9 ? 0 : Math.atan2(v.y, v.x);
export const angleToVector = (angle: number): Point => ({ x: Math.cos(angle), y: Math.sin(angle) });

/** vector2d.cpp subtract_angles: a1 - a2 normalised into (-PI, PI]. */
function subtractAngles(a1: number, a2: number): number {
  let d = a1 - a2;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/** vector2d.cpp angle_between_vecs(vec1, vec2) = angle(vec2) - angle(vec1). */
function angleBetweenVecs(vec1: Point, vec2: Point): number {
  return subtractAngles(vectorToAngle(vec2), vectorToAngle(vec1));
}

// ---------------------------------------------------------------------------
// Beta spline (CBeta, tension 5, bias 1) — the "Woodring" balloon outline.

const BETA_TENSION = 5.0;
const BETA_BIAS = 1.0;

export function betaMatrix(tension = BETA_TENSION, bias = BETA_BIAS): Matrix {
  const b2 = bias * bias;
  const b3 = bias * b2;
  const d = 1.0 / (tension + 2.0 * b3 + 4.0 * (b2 + bias) + 2.0);
  const m: Matrix = [
    [-2.0 * b3, 2.0 * (tension + b3 + b2 + bias), -2.0 * (tension + b2 + bias + 1.0), 2.0],
    [6.0 * b3, -3.0 * (tension + 2.0 * (b3 + b2)), 3.0 * (tension + 2.0 * b2), 0.0],
    [-6.0 * b3, 6.0 * (b3 - bias), 6.0 * bias, 0.0],
    [2.0 * b3, tension + 4.0 * (b2 + bias), 2.0, 0.0],
  ];
  return m.map((row) => row.map((value) => value * d));
}

const BETA = betaMatrix();

export class BetaSpline {
  cps: Point[];
  closed: boolean;
  bezpts: Point[] = [];

  constructor(cps: Point[], closed: boolean) {
    if (cps.length < 2) throw new Error("A spline needs at least two control points");
    this.cps = cps.map((p) => ({ ...p }));
    this.closed = closed;
    this.computeBezpts();
  }

  clone(): BetaSpline {
    return new BetaSpline(this.cps, this.closed);
  }

  /** CBeta::GetDups — duplicated end knots for an open spline. */
  private get dups(): number {
    return 3;
  }

  knotCount(): number {
    return this.closed ? this.cps.length + 3 : this.cps.length + 4;
  }

  bezierCount(): number {
    return 3 * this.knotCount() - 8;
  }

  knot(index: number): Point {
    const n = this.cps.length;
    if (this.closed) {
      if (index === 0) return this.cps[n - 1];
      if (index === n + 1) return this.cps[0];
      if (index === n + 2) return this.cps[1];
      return this.cps[index - 1];
    }
    if (index < this.dups) return this.cps[0];
    if (index >= n + this.dups - 2) return this.cps[n - 1];
    return this.cps[index - this.dups + 1];
  }

  computeBezpts(): void {
    const nKnots = this.knotCount();
    const out: Point[] = [];
    for (let i = 0; i + 4 <= nKnots; i += 1) {
      const k = [this.knot(i), this.knot(i + 1), this.knot(i + 2), this.knot(i + 3)];
      const coeff = (row: number): Point => ({
        x: BETA[row][0] * k[0].x + BETA[row][1] * k[1].x + BETA[row][2] * k[2].x + BETA[row][3] * k[3].x,
        y: BETA[row][0] * k[0].y + BETA[row][1] * k[1].y + BETA[row][2] * k[2].y + BETA[row][3] * k[3].y,
      });
      const c3 = coeff(0);
      const c2 = coeff(1);
      const c1 = coeff(2);
      const c0 = coeff(3);
      // CubicToBezier
      const b1 = add(c0, scale(1 / 3, c1));
      const b2 = add(b1, scale(1 / 3, add(c1, c2)));
      const b3 = add(add(c0, c1), add(c2, c3));
      if (i === 0) out.push(c0);
      out.push(b1, b2, b3);
    }
    this.bezpts = out;
  }

  /** CSpline::ClosestPoint — returns the point and its "knot index" (segment + 2). */
  closestPoint(to: Point): { point: Point; knotIndex: number } {
    let minDist = Infinity;
    let best: Point = this.bezpts[0];
    let knotIndex = 2;
    for (let i = 0; i < this.bezpts.length - 1; i += 3) {
      const found = bezierNearestPoint(this.bezpts.slice(i, i + 4) as Bezier, to);
      if (found.dist < minDist) {
        minDist = found.dist;
        best = found.point;
        knotIndex = i / 3 + 2;
      }
    }
    return { point: best, knotIndex };
  }

  /** CSpline::WalkHorizontalDistance — walk forward along the curve until x >= goalX. */
  walkHorizontalDistance(fromKnotIndex: number, goalX: number): { point: Point; knotIndex: number } {
    const bezCount = this.bezpts.length;
    let index = (fromKnotIndex - 2) * 3;
    let knotIndex = -1;
    let lastFurthest: Point = { x: -100000, y: -100000 };
    for (let i = 0; i < bezCount - 1; i += 3) {
      if (index + 3 > bezCount - 1) index = 0;
      const walk = walkHorizontalDist(this.bezpts.slice(index, index + 4) as Bezier, goalX);
      if (walk.found) return { point: walk.furthest, knotIndex: index / 3 + 2 };
      if (walk.furthest.x > lastFurthest.x) {
        knotIndex = index / 3 + 2;
        lastFurthest = walk.furthest;
      }
      index += 3;
    }
    return { point: lastFurthest, knotIndex };
  }

  /** Path commands continuing from the current point (bezpts[0]). */
  toPath(): PathCommand[] {
    const out: PathCommand[] = [];
    for (let i = 1; i + 2 < this.bezpts.length; i += 3) {
      out.push({ op: "bezier", c1: this.bezpts[i], c2: this.bezpts[i + 1], to: this.bezpts[i + 2] });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Bezier helpers (splinutl.cpp)

export type Bezier = [Point, Point, Point, Point];

const EPSILON = 1.0;

function splitBezier(b: Bezier): [Bezier, Bezier] {
  const mid = (a: Point, c: Point): Point => scale(0.5, add(a, c));
  const l1 = mid(b[0], b[1]);
  const t = mid(b[1], b[2]);
  const l2 = mid(l1, t);
  const r2 = mid(b[2], b[3]);
  const r1 = mid(t, r2);
  const m = mid(l2, r1);
  return [
    [b[0], l1, l2, m],
    [m, r1, r2, b[3]],
  ];
}

function insideBboxTol(p: Point, xmin: number, xmax: number, ymin: number, ymax: number, tol: number): boolean {
  return !(p.x + tol < xmin || p.x - tol > xmax || p.y + tol < ymin || p.y - tol > ymax);
}

function flatBezier(b: Bezier): boolean {
  const xmin = Math.min(b[0].x, b[3].x);
  const xmax = Math.max(b[0].x, b[3].x);
  const ymin = Math.min(b[0].y, b[3].y);
  const ymax = Math.max(b[0].y, b[3].y);
  if (!insideBboxTol(b[1], xmin, xmax, ymin, ymax, 0.5 * EPSILON)) return false;
  if (!insideBboxTol(b[2], xmin, xmax, ymin, ymax, 0.5 * EPSILON)) return false;
  const d1 = sub(b[1], b[0]);
  const d2 = sub(b[2], b[0]);
  const d = sub(b[3], b[0]);
  const dx = Math.abs(d.x);
  const dy = Math.abs(d.y);
  if (dx + dy < EPSILON) return true;
  if (dy < dx) {
    const dydx = d.y / d.x;
    return Math.abs(d2.y - d2.x * dydx) < EPSILON && Math.abs(d1.y - d1.x * dydx) < EPSILON;
  }
  const dxdy = d.x / d.y;
  return Math.abs(d2.x - d2.y * dxdy) < EPSILON && Math.abs(d1.x - d1.y * dxdy) < EPSILON;
}

/** subdivide(): visit points roughly `delta` apart; stop when visit returns true. */
function subdivide(b: Bezier, visit: (p: Point) => boolean, delta: number, depth = 0): boolean {
  if (depth > 24 || flatBezier(b)) {
    const length = distance(b[0], b[3]);
    if (length > 1e-9) {
      const step = delta / length;
      for (let alpha = 0; alpha <= 1.0; alpha += step) {
        if (visit(add(scale(alpha, b[3]), scale(1 - alpha, b[0])))) return true;
      }
    }
    return visit(b[3]);
  }
  const [left, right] = splitBezier(b);
  return subdivide(left, visit, delta, depth + 1) || subdivide(right, visit, delta, depth + 1);
}

/** Uses Manhattan distance, as the original does for speed. */
export function bezierNearestPoint(b: Bezier, given: Point): { dist: number; point: Point } {
  let dist = Infinity;
  let point = b[0];
  subdivide(
    b,
    (p) => {
      const d = Math.abs(p.x - given.x) + Math.abs(p.y - given.y);
      if (d < dist) {
        dist = d;
        point = p;
      }
      return false;
    },
    EPSILON,
  );
  return { dist: Math.trunc(dist), point: { x: Math.trunc(point.x), y: Math.trunc(point.y) } };
}

function walkHorizontalDist(b: Bezier, goalX: number): { found: boolean; furthest: Point } {
  let furthest: Point = { x: -1000000, y: 0 };
  const found = subdivide(
    b,
    (p) => {
      if (p.x > furthest.x) furthest = p;
      return p.x >= goalX;
    },
    EPSILON,
  );
  return { found, furthest: { x: Math.round(furthest.x), y: Math.round(furthest.y) } };
}

// ---------------------------------------------------------------------------
// Arcs (arc.cpp DrawArc2 / ScanArc) — converted straight to cubic beziers.

const ARCSTEP = Math.PI / 2;

function scanArcAux(A: Point, C: Point, center: Point, radius: number, angle: number): PathCommand {
  const s = Math.cos(angle / 2);
  const tau = (4 * s) / (3 * (s + 1));
  const divisor = (A.x * C.y - A.y * C.x) / (radius * radius);
  const B = { x: (C.y - A.y) / divisor, y: (A.x - C.x) / divisor };
  const tB = scale(tau, B);
  return {
    op: "bezier",
    c1: add(add(scale(1 - tau, A), tB), center),
    c2: add(add(scale(1 - tau, C), tB), center),
    to: add(C, center),
  };
}

function scanArc(center: Point, start: Point, end: Point, ccw: boolean): PathCommand[] {
  let A = sub(start, center);
  const finalC = sub(end, center);
  const radius = magnitude(A);
  let trueAngle = angleBetweenVecs(finalC, A);
  if (ccw) trueAngle = -trueAngle;
  if (trueAngle <= 0) trueAngle += 2 * Math.PI;
  let nextEnd = vectorToAngle(A);
  let step = ccw ? ARCSTEP : -ARCSTEP;
  const out: PathCommand[] = [];
  for (let guard = 0; guard < 8; guard += 1) {
    let C: Point;
    let done = false;
    if (trueAngle > ARCSTEP) {
      nextEnd += step;
      C = scale(radius, angleToVector(nextEnd));
    } else {
      done = true;
      C = finalC;
      step = trueAngle;
    }
    out.push(scanArcAux(A, C, center, radius, step));
    if (done) break;
    A = C;
    trueAngle -= ARCSTEP;
  }
  return out;
}

/**
 * DrawArc2: a circular arc from start to end whose midpoint is displaced by
 * `altitude`. Positive altitude bows to the right of start→end.
 */
export function arcPath(start: Point, end: Point, altitude: number): PathCommand[] {
  if (altitude < 1 && altitude > -1) return [{ op: "line", to: end }];
  const mid = scale(0.5, add(start, end));
  const endToMid = sub(mid, end);
  const endToMidDist = magnitude(endToMid);
  const radius = (endToMidDist * endToMidDist + altitude * altitude) / (2 * altitude);
  const midToCenterDist = radius - altitude;
  let midToCenter = { x: endToMid.y, y: -endToMid.x };
  midToCenter = scale(midToCenterDist / magnitude(midToCenter), midToCenter);
  const center = add(add(end, endToMid), midToCenter);
  return scanArc(center, start, end, altitude > 0);
}

// ---------------------------------------------------------------------------
// Rectangles (SRECT with y-up: top >= bottom)

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function boundsOf(points: Point[]): Rect {
  const r = { left: Infinity, top: -Infinity, right: -Infinity, bottom: Infinity };
  for (const p of points) {
    r.left = Math.min(r.left, p.x);
    r.right = Math.max(r.right, p.x);
    r.top = Math.max(r.top, p.y);
    r.bottom = Math.min(r.bottom, p.y);
  }
  return r;
}
