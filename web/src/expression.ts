// Faithful port of Comic Chat 2.5's text-to-expression pipeline:
//   textpose.cpp  GetEmotionsFromString — rules loaded from chat.rc ID_RULE_*
//   avatar.cpp    CEmotionOpts::Add, CAvatar*::GetBodyFromEmotion(CEmotionOpts&)
//
// Unlike emotion.ts (which keeps one winning emotion), the original keeps
// every matching emotion with a priority and then picks the face and the
// torso separately, so "Hi :)" gets a waving torso *and* a smiling face.

import type { AvatarFile, PoseDescriptor } from "./avb";

const TWO_PI = 2 * Math.PI;

/** avatar.h EM_* — angles on the emotion wheel, or gesture codes above 2π. */
export const EM = {
  HAPPY: 0,
  COY: (1 * TWO_PI) / 8,
  BORED: (2 * TWO_PI) / 8,
  SCARED: (3 * TWO_PI) / 8,
  SAD: (4 * TWO_PI) / 8,
  ANGRY: (5 * TWO_PI) / 8,
  SHOUT: (6 * TWO_PI) / 8,
  LAUGH: (7 * TWO_PI) / 8,
  NEUTRAL: 0,
  WAVE: 1001,
  POINTOTHER: 1002,
  POINTSELF: 1003,
  DOUBLEPOINT: 1004,
  SHRUG: 1005,
} as const;

/** avatario.cpp emFloats: the emotion index stored in .avb files → EM value. */
const EM_FLOATS = [
  0,
  EM.HAPPY,
  EM.COY,
  EM.BORED,
  EM.SCARED,
  EM.SAD,
  EM.ANGRY,
  EM.SHOUT,
  EM.LAUGH,
  EM.NEUTRAL,
  EM.WAVE,
  EM.POINTOTHER,
  EM.POINTSELF,
  EM.DOUBLEPOINT,
  EM.SHRUG,
  1006,
  1007,
  1008,
];

export const emotionOfPose = (pose: PoseDescriptor): number => EM_FLOATS[pose.emotion] ?? 0;
const intensityOfPose = (pose: PoseDescriptor): number => pose.intensity / 255;

export interface EmotionOption {
  emotion: number;
  intensity: number;
  priority: number;
  /** Which rule produced it, for display. */
  source: string;
}

type RuleKind = "AllCaps" | "FindString" | "CheckWord" | "CheckStart";
interface Rule {
  kind: RuleKind;
  arg: string;
  caseSensitive: boolean;
  strength: number;
  emotion: number;
}

/** chat.rc STRINGTABLE ID_RULE_*, in the order InitializeEmotionRules loads them. */
const RULE_TABLE: [number, string][] = [
  [EM.SHOUT, 'AllCaps("");9\nFindString("!!!");9'],
  [EM.LAUGH, 'CheckWord*("ROTFL");11\nCheckWord*("LOL");11\nFindString*("HEHE");11'],
  [EM.HAPPY, 'FindString(":)");10\nFindString(":-)");10'],
  [EM.SAD, 'FindString(":(");10\nFindString(":-(");10'],
  [
    EM.POINTOTHER,
    'CheckStart*("You");4\nCheckWord*("are you");8\nCheckWord*("will you");8\nCheckWord*("did you");8\nCheckWord*("aren\'t you");8\nCheckWord*("don\'t you");8',
  ],
  [EM.POINTSELF, 'CheckStart*("I");3\nCheckWord*("i\'m");7\nCheckWord*("i will");7\nCheckWord*("i\'ll");7\nCheckWord*("i am");7'],
  [EM.WAVE, 'CheckStart*("Hi");2\nCheckStart*("Bye");3\nCheckStart*("Hello");5\nCheckStart*("Welcome");5\nCheckStart*("Howdy");5'],
  [EM.COY, 'FindString(";-)");10\nFindString(";)");10'],
  // ID_RULE_ANGRY, ID_RULE_SCARED and ID_RULE_BORED shipped empty.
];

/** LoadCompositeRule / LoadSingleRule / RegisterRule */
export function parseRules(table: [number, string][] = RULE_TABLE): Rule[] {
  const rules: Rule[] = [];
  for (const [emotion, text] of table) {
    for (const entry of text.split("\n")) {
      const match = entry.match(/^\s*([A-Za-z]+)(\*?)\("([^"]*)"\);(\d+)/);
      if (!match) continue;
      const kind = match[1] as RuleKind;
      const caseSensitive = match[2] !== "*";
      rules.push({
        kind,
        arg: caseSensitive ? match[3] : match[3].toLowerCase(),
        caseSensitive,
        strength: Number(match[4]),
        emotion,
      });
    }
  }
  return rules;
}

const DEFAULT_RULES = parseRules();

const isLower = (c: string) => c >= "a" && c <= "z";
const isUpper = (c: string) => c >= "A" && c <= "Z";
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isAlnum = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[!-/:-@[-`{-~]/.test(c);

/** CheckForUppers: no lower-case letters and more than one upper-case one. */
function checkForUppers(s: string): boolean {
  let uppers = 0;
  for (const c of s) {
    if (isLower(c)) return false;
    if (isUpper(c)) uppers += 1;
  }
  return uppers > 1;
}

/** CheckWord: substring that starts a word and ends at space/punct/end. */
function checkWord(s: string, sub: string): boolean {
  let at = s.indexOf(sub);
  while (at >= 0) {
    if (at === 0 || isSpace(s[at - 1])) {
      const after = s[at + sub.length];
      if (after === undefined || isSpace(after) || isPunct(after)) return true;
    }
    at = s.indexOf(sub, at + 1);
  }
  return false;
}

/** StartCompare2: s begins with sub and the next character is not alphanumeric. */
function startCompare(s: string, sub: string): boolean {
  return s.startsWith(sub) && !isAlnum(s[sub.length]);
}

/** GetNextSentenceStart */
function nextSentenceStart(s: string, from: number): number {
  let i = from;
  while (i < s.length && !".!?".includes(s[i])) i += 1;
  if (i >= s.length) return -1;
  while (i < s.length && (isPunct(s[i]) || isSpace(s[i]))) i += 1;
  return i;
}

export interface ExpressionOptions {
  /**
   * The shipped code tests CheckStart rules against the start of the whole
   * message once per sentence (it passes `buff` instead of `bptr`), so only
   * the first sentence ever counts. Set true to check every sentence, which
   * is what the code evidently meant to do.
   */
  everySentence?: boolean;
  rules?: Rule[];
}

/** CEmotionOpts::Add with OVERRIDEBYPRIORITY (MAXEMOPTS = 10). */
function addOption(options: EmotionOption[], option: EmotionOption): void {
  const existing = options.find((o) => o.emotion === option.emotion);
  if (existing) {
    if (existing.priority < option.priority) Object.assign(existing, option);
    return;
  }
  if (options.length < 10) options.push(option);
}

/** textpose.cpp GetEmotionsFromString */
export function emotionOptions(message: string, settings: ExpressionOptions = {}): EmotionOption[] {
  const rules = settings.rules ?? DEFAULT_RULES;
  const buff = message;
  const lower = message.toLowerCase();
  const options: EmotionOption[] = [];
  const add = (rule: Rule) =>
    addOption(options, { emotion: rule.emotion, intensity: 1.0, priority: rule.strength, source: `${rule.kind}("${rule.arg}")` });

  for (const rule of rules) if (rule.kind === "AllCaps" && checkForUppers(buff)) add(rule);
  for (const rule of rules) {
    if (rule.kind !== "FindString") continue;
    if ((rule.caseSensitive ? buff : lower).includes(rule.arg)) add(rule);
  }
  for (const rule of rules) {
    if (rule.kind !== "CheckWord") continue;
    if (checkWord(rule.caseSensitive ? buff : lower, rule.arg)) add(rule);
  }
  let at = 0;
  while (at < buff.length && isSpace(buff[at])) at += 1;
  while (at >= 0 && at < buff.length) {
    const from = settings.everySentence ? at : 0;
    for (const rule of rules) {
      if (rule.kind !== "CheckStart") continue;
      if (startCompare((rule.caseSensitive ? buff : lower).slice(from), rule.arg)) add(rule);
    }
    at = nextSentenceStart(buff, at);
  }
  return options;
}

// ---------------------------------------------------------------------------
// Choosing poses

/** vector2d.cpp value_to_angle / subtract_angles */
function subtractAngles(a: number, b: number): number {
  const value = a - b;
  if (value > -Math.PI && value <= Math.PI) return value;
  let temp = value / TWO_PI;
  temp = (temp - Math.trunc(temp)) * TWO_PI;
  if (temp > Math.PI) return temp - TWO_PI;
  if (temp <= -Math.PI) return temp + TWO_PI;
  return temp;
}

/** Nearest angle, tie-broken by intensity (GetHeadAndBodyFromEmotion's face loop). */
function nearestByAngle(poses: PoseDescriptor[], emotion: number, intensity: number): number {
  let nearestAngle = 3 * Math.PI;
  let nearestIntensity = 2.0;
  let found = -1;
  poses.forEach((pose, i) => {
    const angle = Math.abs(subtractAngles(emotionOfPose(pose), emotion));
    if (angle <= nearestAngle) {
      const delta = Math.abs(intensity - intensityOfPose(pose));
      if (angle === nearestAngle && delta >= nearestIntensity) return;
      nearestAngle = angle;
      nearestIntensity = delta;
      found = i;
    }
  });
  return found;
}

const exactGesture = (poses: PoseDescriptor[], emotion: number): number =>
  poses.findIndex((pose) => emotionOfPose(pose) === emotion);

/** SetFaceNeutral / SetTorsoNeutral / SetBodyNeutral: rotate through neutral poses. */
function nextNeutral(poses: PoseDescriptor[], last: number): number {
  let c = last;
  for (let i = 0; i < poses.length; i += 1) {
    c = (c + 1) % poses.length;
    if (emotionOfPose(poses[c]) === EM.NEUTRAL && poses[c].intensity === 0) return c;
  }
  return 0;
}

/** Per-avatar rotation state (m_lastBody / m_lastFace / m_lastTorso). */
export interface PoseMemory {
  lastBody: number;
  lastFace: number;
  lastTorso: number;
}

export const newPoseMemory = (): PoseMemory => ({ lastBody: -1, lastFace: -1, lastTorso: -1 });

export type PoseChoice =
  | { kind: "simple"; body: number }
  | { kind: "complex"; face: number; torso: number };

/**
 * CAvatarSimple/CAvatarComplex::GetBodyFromEmotion(CEmotionOpts&). Emotions
 * are tried from highest priority down; faces match by nearest angle, and
 * torsos only by an exact gesture (wave, point...). Whatever is left
 * unfilled falls back to the next neutral pose in rotation.
 */
export function choosePoses(avatar: AvatarFile, options: EmotionOption[], memory: PoseMemory = newPoseMemory()): PoseChoice {
  const pending = options.map((o) => ({ ...o }));
  const nextBest = () => {
    let best = -1;
    let priority = 0;
    pending.forEach((o, i) => {
      if (o.priority > priority) {
        best = i;
        priority = o.priority;
      }
    });
    if (best < 0) return undefined;
    const option = pending[best];
    pending[best] = { ...option, priority: 0 };
    return option;
  };

  if (avatar.faces.length && avatar.torsos.length) {
    let face = -1;
    let torso = -1;
    for (let option = nextBest(); option; option = nextBest()) {
      const f = option.emotion <= TWO_PI ? nearestByAngle(avatar.faces, option.emotion, option.intensity) : -1;
      const t = option.emotion > TWO_PI ? exactGesture(avatar.torsos, option.emotion) : -1;
      if (f >= 0 && face < 0) face = f;
      if (t >= 0 && torso < 0) torso = t;
      if (face >= 0 && torso >= 0) break;
    }
    if (face < 0) face = nextNeutral(avatar.faces, memory.lastFace);
    if (torso < 0) torso = nextNeutral(avatar.torsos, memory.lastTorso);
    memory.lastFace = face;
    memory.lastTorso = torso;
    return { kind: "complex", face, torso };
  }

  let body = -1;
  for (let option = nextBest(); option; option = nextBest()) {
    const b =
      option.emotion <= TWO_PI
        ? nearestByAngle(avatar.bodies, option.emotion, option.intensity)
        : exactGesture(avatar.bodies, option.emotion);
    if (b >= 0) {
      body = b;
      break;
    }
  }
  if (body < 0) body = nextNeutral(avatar.bodies, memory.lastBody);
  memory.lastBody = body;
  return { kind: "simple", body };
}

const NAMES: [number, string][] = [
  [EM.WAVE, "waving"],
  [EM.POINTOTHER, "pointing"],
  [EM.POINTSELF, "pointing to self"],
  [EM.SHOUT, "shouting"],
  [EM.LAUGH, "laughing"],
  [EM.COY, "coy"],
  [EM.SAD, "sad"],
  [EM.HAPPY, "happy"],
];

/** A short human label for the strongest option, e.g. for a status line. */
export function describeOptions(options: EmotionOption[]): string {
  if (!options.length) return "neutral";
  return [...options]
    .sort((a, b) => b.priority - a.priority)
    .map((o) => NAMES.find(([e]) => e === o.emotion)?.[1] ?? "expressive")
    .filter((name, i, all) => all.indexOf(name) === i)
    .join(" + ");
}
