import type { PoseDescriptor } from "./avb";

export type EmotionName =
  | "neutral"
  | "happy"
  | "coy"
  | "bored"
  | "scared"
  | "sad"
  | "angry"
  | "shout"
  | "laugh"
  | "wave"
  | "point-other"
  | "point-self";

export interface EmotionResult {
  name: EmotionName;
  label: string;
  emotionIndex: number;
  intensity: number;
  reason: string;
}

interface RuleMatch extends EmotionResult {
  priority: number;
}

const definitions: Record<EmotionName, Omit<EmotionResult, "name" | "reason">> = {
  neutral: { label: "Neutral", emotionIndex: 9, intensity: 0 },
  happy: { label: "Happy", emotionIndex: 1, intensity: 1 },
  coy: { label: "Coy", emotionIndex: 2, intensity: 1 },
  bored: { label: "Bored", emotionIndex: 3, intensity: 1 },
  scared: { label: "Scared", emotionIndex: 4, intensity: 1 },
  sad: { label: "Sad", emotionIndex: 5, intensity: 1 },
  angry: { label: "Angry", emotionIndex: 6, intensity: 1 },
  shout: { label: "Shouting", emotionIndex: 7, intensity: 1 },
  laugh: { label: "Laughing", emotionIndex: 8, intensity: 1 },
  wave: { label: "Waving", emotionIndex: 10, intensity: 1 },
  "point-other": { label: "Pointing", emotionIndex: 11, intensity: 0.8 },
  "point-self": { label: "Pointing to self", emotionIndex: 12, intensity: 0.8 },
};

function result(name: EmotionName, reason: string, priority = 0): RuleMatch {
  return { name, reason, priority, ...definitions[name] };
}

function hasWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?=$|\\s|[.,!?;:])`, "i").test(text);
}

function startsSentenceWith(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[.!?]\\s*)${escaped}(?=$|\\s|[.,!?;:])`, "i").test(text.trim());
}

function isAllCaps(text: string): boolean {
  const letters = [...text].filter((character) => /[a-z]/i.test(character));
  return letters.length > 1 && letters.every((character) => character === character.toUpperCase());
}

export function analyzeMessage(message: string): EmotionResult {
  const text = message.trim();
  if (!text) return result("neutral", "No expression cues");

  const matches: RuleMatch[] = [];
  if (isAllCaps(text) || text.includes("!!!")) matches.push(result("shout", "Caps or exclamation marks", 9));
  if (hasWord(text, "ROTFL") || hasWord(text, "LOL") || /hehe/i.test(text)) {
    matches.push(result("laugh", "Laughter cue", 11));
  }
  if (text.includes(":-)") || text.includes(":)")) matches.push(result("happy", "Happy emoticon", 10));
  if (text.includes(":-(") || text.includes(":(")) matches.push(result("sad", "Sad emoticon", 10));
  if (text.includes(";-)") || text.includes(";)")) matches.push(result("coy", "Winking emoticon", 10));

  if (["hi", "bye", "hello", "welcome", "howdy"].some((word) => startsSentenceWith(text, word))) {
    matches.push(result("wave", "Greeting", 5));
  }
  if (startsSentenceWith(text, "you") || ["are you", "will you", "did you", "aren't you", "don't you"].some((phrase) => hasWord(text, phrase))) {
    matches.push(result("point-other", "Addressing someone", 8));
  }
  if (startsSentenceWith(text, "i") || ["i'm", "i am", "i will", "i'll"].some((phrase) => hasWord(text, phrase))) {
    matches.push(result("point-self", "Talking about self", 7));
  }

  if (matches.length === 0) return result("neutral", "No expression cues");
  return matches.reduce((best, candidate) => candidate.priority > best.priority ? candidate : best);
}

function isNeutralPose(pose: PoseDescriptor): boolean {
  return (pose.emotion === 0 || pose.emotion === 9) && pose.intensity === 0;
}

export function selectPose(poses: PoseDescriptor[], emotion: EmotionResult): number {
  if (poses.length === 0) throw new Error("Avatar has no poses");

  const exact = poses
    .map((pose, index) => ({ pose, index }))
    .filter(({ pose }) => emotion.name === "neutral" ? isNeutralPose(pose) : pose.emotion === emotion.emotionIndex);
  const candidates = exact.length > 0
    ? exact
    : poses.map((pose, index) => ({ pose, index })).filter(({ pose }) => isNeutralPose(pose));
  const usable = candidates.length > 0 ? candidates : poses.map((pose, index) => ({ pose, index }));

  return usable.reduce((best, candidate) => {
    const bestDistance = Math.abs(best.pose.intensity / 255 - emotion.intensity);
    const candidateDistance = Math.abs(candidate.pose.intensity / 255 - emotion.intensity);
    return candidateDistance < bestDistance ? candidate : best;
  }).index;
}
