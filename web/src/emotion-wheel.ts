// The emotion wheel from the Comic Chat 2.5 window (CBodyCam in bodycam.cpp):
// drag inside the circle to choose an emotion by angle and an intensity by
// distance from the centre; the character preview follows.

import type { AvatarFile, PoseDescriptor } from "./avb";
import { EM, emotionOfPose, type PoseChoice, type PoseMemory } from "./expression";
import { WHEEL_ICONS } from "./wheel-icons";

export interface WheelEmotion {
  /** Angle in radians, screen coordinates (y down): 0 = right, π/2 = down. */
  emotion: number;
  /** 0..1, snapped to 0 inside the centre detent. */
  intensity: number;
}

// bodycam.cpp geometry (device pixels at 96 dpi)
export const WHEEL = {
  maxSide: 159,
  minSide: 93,
  cursorRadius: 5,
  iconWidth: 20,
  iconHeight: 26,
  detent: 0.2,
} as const;

const NEMOTIONS = 8;
/** ID_EM_HAPPY..ID_EM_NEUTRAL, in wheel order. */
export const EMOTION_NAMES = ["Happy", "Coy", "Bored", "Scared", "Sad", "Angry", "Shout", "Laugh", "Neutral"] as const;
const ICON_KEYS = ["happy", "coy", "bored", "scared", "sad", "angry", "shout", "laugh"] as const;

export interface WheelGeometry {
  side: number;
  center: { x: number; y: number };
  /** Radius the cursor can travel (circle radius minus the cursor). */
  radius: number;
  /** Radius of the drawn circle. */
  circleRadius: number;
}

/** CacheBullSide + DrawBullsEye, for a square wheel of the given width. */
export function wheelGeometry(width: number, scale = 1): WheelGeometry | null {
  const side = Math.min(width, WHEEL.maxSide * scale);
  if (side < WHEEL.minSide * scale) return null; // m_bullDisabled
  const half = Math.trunc(side / 2);
  const circleRadius = half - WHEEL.cursorRadius * scale - WHEEL.iconHeight * scale;
  return { side, center: { x: width / 2, y: side - half }, circleRadius, radius: circleRadius - WHEEL.cursorRadius * scale };
}

/** CBodyCam::GetEmotionFromPoint */
export function emotionFromPoint(g: WheelGeometry, x: number, y: number): WheelEmotion {
  const dx = x - g.center.x;
  const dy = y - g.center.y;
  let intensity = Math.min(Math.hypot(dx, dy) / g.radius, 1.0);
  if (intensity < WHEEL.detent) intensity = 0;
  return { intensity, emotion: intensity === 0 ? 0 : Math.atan2(dy, dx) };
}

/** CBodyCam::GetPointFromEmotion */
export function pointFromEmotion(g: WheelGeometry, e: WheelEmotion): { x: number; y: number } {
  return {
    x: g.center.x + Math.round(Math.cos(e.emotion) * g.radius * e.intensity),
    y: g.center.y + Math.round(Math.sin(e.emotion) * g.radius * e.intensity),
  };
}

/** CBodyCam::GetIconRect — icon centres around the rim, clockwise from Happy at 3 o'clock. */
export function iconCenters(g: WheelGeometry, scale = 1): { x: number; y: number }[] {
  const offset = g.radius + 2 * WHEEL.cursorRadius * scale + (WHEEL.iconHeight * scale) / 2;
  return Array.from({ length: NEMOTIONS }, (_, i) => {
    const angle = (2 * Math.PI * i) / NEMOTIONS;
    return { x: g.center.x + Math.round(offset * Math.cos(angle)), y: g.center.y + Math.round(offset * Math.sin(angle)) };
  });
}

/** StringFromEmotion */
export function emotionName(e: WheelEmotion): (typeof EMOTION_NAMES)[number] {
  const a = e.emotion;
  if (e.intensity === 0) return "Neutral";
  if (a >= (7 * Math.PI) / 8 || a < (-7 * Math.PI) / 8) return "Sad";
  if (a <= (-5 * Math.PI) / 8) return "Angry";
  if (a <= (-3 * Math.PI) / 8) return "Shout";
  if (a <= -Math.PI / 8) return "Laugh";
  if (a > (5 * Math.PI) / 8) return "Scared";
  if (a > (3 * Math.PI) / 8) return "Bored";
  if (a > Math.PI / 8) return "Coy";
  return "Happy";
}

/** OnKeyDown without Ctrl: snap through preset angles and 0/50/100 % intensity. */
export function stepEmotion(e: WheelEmotion, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): WheelEmotion {
  const circular = key === "ArrowLeft" || key === "ArrowRight";
  const decrease = key === "ArrowLeft" || key === "ArrowDown";
  const table = circular ? Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 - Math.PI) : [0, 0.5, 1];
  const current = circular ? e.emotion : e.intensity;
  const n = table.length;
  let goTo = circular ? (decrease ? n - 1 : 1) : decrease ? n - 2 : n;
  for (let i = 0; i < n; i += 1) {
    if (current < table[i]) {
      goTo = decrease ? i - 1 : i;
      break;
    }
    if (current === table[i]) {
      goTo = decrease ? i - 1 : i + 1;
      break;
    }
  }
  if (goTo === -1) goTo = circular ? n - 1 : 0;
  else if (goTo === n) goTo = circular ? 0 : n - 1;
  return circular ? { ...e, emotion: table[goTo] } : { ...e, intensity: table[goTo] };
}

// ---------------------------------------------------------------------------
// Picking a pose for one explicit emotion (GetBodyFromEmotion(CEmotion&))

function subtractAngles(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

const isNeutral = (p: PoseDescriptor) => emotionOfPose(p) === EM.NEUTRAL && p.intensity === 0;
const isGesture = (p: PoseDescriptor) => emotionOfPose(p) > 7;

/** Poses within π/8 of the emotion (or neutral ones), closest in intensity, searched from after `last`. */
function nearbyByIntensity(poses: PoseDescriptor[], e: WheelEmotion, last: number, simpleNeutralRule: boolean): number {
  let bestDelta = 2.0;
  let found = -1;
  for (let i = 0; i < poses.length; i += 1) {
    const index = (last + 1 + i + poses.length) % poses.length;
    const pose = poses[index];
    if (isGesture(pose)) continue;
    const angle = Math.abs(subtractAngles(emotionOfPose(pose), e.emotion));
    const firstNeutral = simpleNeutralRule ? isNeutral(pose) && found === -1 : isNeutral(pose);
    if (angle < Math.PI / NEMOTIONS || firstNeutral) {
      const delta = simpleNeutralRule && firstNeutral && e.intensity > 0 ? 1.5 : Math.abs(e.intensity - pose.intensity / 255);
      if (delta < bestDelta) {
        bestDelta = delta;
        found = index;
      }
    }
  }
  return found;
}

/**
 * CAvatarSimple/CAvatarComplex::GetBodyFromEmotion(CEmotion&): what the
 * character preview shows while you drag the wheel.
 */
export function posesForWheel(avatar: AvatarFile, e: WheelEmotion, memory: PoseMemory): PoseChoice {
  if (avatar.faces.length && avatar.torsos.length) {
    let nearestAngle = 3 * Math.PI;
    let nearestIntensity = 2.0;
    let face = 0;
    avatar.faces.forEach((pose, i) => {
      const angle = Math.abs(subtractAngles(emotionOfPose(pose), e.emotion));
      if (angle <= nearestAngle) {
        const delta = Math.abs(e.intensity - pose.intensity / 255);
        if (angle === nearestAngle && delta >= nearestIntensity) return;
        nearestAngle = angle;
        nearestIntensity = delta;
        face = i;
      }
    });
    let torso = nearbyByIntensity(avatar.torsos, e, memory.lastTorso, false);
    if (torso < 0) torso = avatar.torsos.findIndex(isNeutral);
    if (torso < 0) torso = 0;
    memory.lastFace = face;
    memory.lastTorso = torso;
    return { kind: "complex", face, torso };
  }
  let body = nearbyByIntensity(avatar.bodies, e, memory.lastBody, true);
  if (body < 0) body = Math.max(0, avatar.bodies.findIndex(isNeutral));
  memory.lastBody = body;
  return { kind: "simple", body };
}

// ---------------------------------------------------------------------------
// DOM widget

export interface EmotionWheelOptions {
  /** CSS pixel width; the wheel is square and at most 159 px (scaled). */
  size?: number;
  onChange?: (emotion: WheelEmotion, name: string) => void;
}

export interface EmotionWheel {
  element: HTMLCanvasElement;
  get value(): WheelEmotion;
  set(emotion: WheelEmotion): void;
}

export function createEmotionWheel(options: EmotionWheelOptions = {}): EmotionWheel {
  const size = options.size ?? WHEEL.maxSide;
  const scale = size / WHEEL.maxSide;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.touchAction = "none";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Emotion");
  const context = canvas.getContext("2d")!;
  const geometry = wheelGeometry(size, scale)!;
  const icons = ICON_KEYS.map((key) => {
    const image = new Image();
    image.src = WHEEL_ICONS[key];
    image.addEventListener("load", draw);
    return image;
  });
  let value: WheelEmotion = { emotion: 0, intensity: 0 };
  let dragging = false;

  function draw(): void {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "rgb(210, 210, 210)";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#fff";
    context.strokeStyle = "#000";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y, geometry.circleRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(geometry.center.x - 5 * scale, geometry.center.y);
    context.lineTo(geometry.center.x + 5 * scale, geometry.center.y);
    context.moveTo(geometry.center.x, geometry.center.y - 5 * scale);
    context.lineTo(geometry.center.x, geometry.center.y + 5 * scale);
    context.stroke();
    context.imageSmoothingEnabled = false;
    iconCenters(geometry, scale).forEach((c, i) => {
      const w = WHEEL.iconWidth * scale;
      const h = WHEEL.iconHeight * scale;
      if (icons[i].complete) context.drawImage(icons[i], c.x - w / 2, c.y - h / 2, w, h);
    });
    const p = pointFromEmotion(geometry, value);
    context.beginPath();
    context.arc(p.x, p.y, WHEEL.cursorRadius * scale, 0, Math.PI * 2);
    context.stroke();
    canvas.setAttribute("aria-valuetext", `${emotionName(value)} ${Math.round(value.intensity * 100)}%`);
  }

  function set(next: WheelEmotion): void {
    const changed = next.emotion !== value.emotion || next.intensity !== value.intensity;
    value = next;
    draw();
    if (changed) options.onChange?.(value, emotionName(value));
  }

  function fromEvent(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    set(emotionFromPoint(geometry, event.clientX - rect.left, event.clientY - rect.top));
  }

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    fromEvent(event);
  });
  canvas.addEventListener("pointermove", (event) => dragging && fromEvent(event));
  canvas.addEventListener("pointerup", () => (dragging = false));
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Home") set({ emotion: 0, intensity: 0 });
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      set(stepEmotion(value, event.key as "ArrowLeft"));
    } else return;
    event.preventDefault();
  });
  draw();
  return {
    element: canvas,
    get value() {
      return value;
    },
    set,
  };
}
