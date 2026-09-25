// Lines from the original Microsoft Comic Chat client. With comics data on,
// it put the speaker's pose, balloon and addressees in front of every line:
//
//   (#G<torso><emotion><intensity>E<face><emotion><intensity>[R]M<mode>[T<nick>,<nick>]) text
//
// Each field is one character, a number plus '0' (protsupp.cpp
// bInsertAnnotations, IndexToByte). Text-only IRC users saw that prefix as
// junk; here it's taken off the balloon and used to draw the pose they chose.

import type { AvatarFile } from "./avb";
import type { BalloonMode } from "./layout/balloon";
import type { PoseChoice } from "./expression";

/** One half of the pose: which pose in the sender's file, and what emotion it shows. */
export interface AnnotatedPose {
  /** Index into the sender's torsos (G, or the whole body for a one-piece character) or faces (E). -1 if missing. */
  index: number;
  /** avatario.cpp emFloats index: 1-8 the emotion wheel, 9 neutral, 10+ gestures. -1 if missing. */
  emotion: number;
  /** 0-10. -1 if missing. */
  intensity: number;
}

export interface ComicChatAnnotation {
  gesture: AnnotatedPose;
  expression: AnnotatedPose;
  /** The sender picked this pose by hand (the R flag). */
  requested: boolean;
  mode: BalloonMode;
  /** Nicknames the line was addressed to (T), as sent. */
  talkTo: string[];
  /** The words said, with the annotation removed. */
  text: string;
}

// defines.h SM_*
const MODES: Record<number, BalloonMode> = { 1: "say", 2: "whisper", 3: "think", 5: "action" };
const MISSING: AnnotatedPose = { index: -1, emotion: -1, intensity: -1 };
const byteToIndex = (char: string | undefined): number => (char === undefined ? -1 : char.charCodeAt(0) - 48);

function readPose(body: string, at: number): { pose: AnnotatedPose; next: number } {
  const fields = [body[at], body[at + 1], body[at + 2]];
  const count = fields.findIndex((field) => field === undefined);
  const read = count === -1 ? 3 : count;
  const [index, emotion, intensity] = fields.map((field) => byteToIndex(field));
  return { pose: { index, emotion, intensity }, next: at + read };
}

/**
 * Parse a Comic Chat annotation off the front of a line (ProcessSay). Like the
 * original, a prefix is only removed when both poses carry an intensity, so an
 * ordinary line that happens to start with "(#" is left alone.
 */
export function parseComicChatAnnotation(line: string, privateMessage = false): ComicChatAnnotation | null {
  if (!line.startsWith("(#")) return null;
  const end = line.indexOf(") ", 2);
  if (end < 0) return null;
  const body = line.slice(2, end);
  let at = 0;
  let gesture = MISSING;
  let expression = MISSING;
  let requested = false;
  let modeNumber = 1;
  let talkTo: string[] = [];
  if (body[at] === "G") ({ pose: gesture, next: at } = readPose(body, at + 1));
  if (body[at] === "E") ({ pose: expression, next: at } = readPose(body, at + 1));
  if (body[at] === "R") {
    requested = true;
    at += 1;
  }
  if (body[at] === "M") {
    modeNumber = byteToIndex(body[at + 1]);
    at += 2;
  }
  if (body[at] === "T") {
    talkTo = body.slice(at + 1).split(/[\s,.]+/u).filter(Boolean).slice(0, 5);
  }
  if (gesture.intensity < 0 || expression.intensity < 0) return null;
  let mode = MODES[modeNumber] ?? "say";
  // "anti-hacker line": a private message is always a whisper, and a
  // channel line can't claim to be one.
  if (privateMessage && (mode === "say" || mode === "think")) mode = "whisper";
  if (!privateMessage && mode === "whisper") mode = "say";
  return { gesture, expression, requested, mode, talkTo, text: line.slice(end + 2) };
}

/** 0-10 on the wire → 0-255 as stored in a pose. */
const poseIntensity = (intensity: number) => Math.round((Math.max(0, Math.min(10, intensity)) / 10) * 255);

/** The pose in `poses` showing this emotion with the closest intensity (CAvatarSimple::SetEmotions). */
function byEmotion(poses: AvatarFile["faces"], wanted: AnnotatedPose): number {
  let best = -1;
  let bestDelta = Infinity;
  poses.forEach((pose, index) => {
    if (pose.emotion !== wanted.emotion) return;
    const delta = Math.abs(pose.intensity - poseIntensity(wanted.intensity));
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

/** The sent index if that pose shows the sent emotion (the same character file), else the closest match. */
function pick(poses: AvatarFile["faces"], index: number, wanted: AnnotatedPose): number {
  return index >= 0 && index < poses.length && poses[index].emotion === wanted.emotion ? index : byEmotion(poses, wanted);
}

/**
 * The pose to draw for an annotated line (SayEntry::Execute). When we draw the
 * sender with the character they're using, the indices point straight at their
 * pose; otherwise (OTHERMAPPED) it's matched by emotion. Returns null when
 * nothing fits, so the usual text-based rules pick the pose instead.
 */
export function poseForAnnotation(avatar: AvatarFile, annotation: ComicChatAnnotation): PoseChoice | null {
  const { gesture, expression } = annotation;
  if (avatar.faces.length && avatar.torsos.length) {
    let face = pick(avatar.faces, expression.index, expression);
    let torso = pick(avatar.torsos, gesture.index, gesture);
    if (face < 0 && torso < 0) return null;
    // Half a match: keep the other half neutral.
    const neutral = (poses: AvatarFile["faces"]) => Math.max(0, poses.findIndex((pose) => pose.emotion === 9));
    if (face < 0) face = neutral(avatar.faces);
    if (torso < 0) torso = neutral(avatar.torsos);
    return { kind: "complex", face, torso };
  }
  // A one-piece character sends its body in G and that body's emotion in E.
  const body = pick(avatar.bodies, gesture.index, expression);
  return body < 0 ? null : { kind: "simple", body };
}
