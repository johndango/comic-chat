// Optional, deliberately conservative family-view filter. This changes only
// the local comic rendering/export; the original IRC line remains untouched.

const SENSITIVE_TERMS = [
  // Common profanity and sexual/lewd terms.
  "motherfucker", "motherfucking", "fucker", "fucking", "fucked", "fuck",
  "bullshit", "shithead", "shitty", "shit",
  "asshole", "ass", "bitch", "bastard", "cunt", "dick", "cock", "pussy", "twat", "whore", "slut",
  "goddamn", "dammit", "damn", "hell", "crap", "piss", "prick", "wanker",
  "pornography", "pornographic", "porn", "nudes", "nude", "naked", "horny",
  "masturbation", "masturbating", "masturbate", "orgasm", "blowjob", "handjob",
  "sexual intercourse", "intercourse", "rape", "rapist", "incest", "fetish", "erection",
  "penis", "vagina", "anus", "semen", "cum", "boobs", "breasts",

  // Obscene, extremist, or sexual gesture phrases.
  "middle finger", "flip the bird", "flipping the bird", "flipped the bird",
  "flip off", "flipping off", "flipped off", "crotch grab", "obscene gesture",
  "nazi salute", "sieg heil", "heil hitler",

  // Frequently contentious political figures. This is a display preference,
  // not a judgment about every use of a name.
  "donald trump", "trump", "joe biden", "biden", "kamala harris", "barack obama", "obama",
  "vladimir putin", "putin", "xi jinping", "kim jong un", "kim jong-un",
  "benjamin netanyahu", "netanyahu", "volodymyr zelenskyy", "volodymyr zelensky", "zelenskyy", "zelensky",
  "adolf hitler", "hitler", "joseph stalin", "stalin", "benito mussolini", "mussolini", "mao zedong",

  // Major named religious figures and titles commonly used as names.
  "jesus christ", "jesus", "christ", "muhammad", "mohammed", "mohammad", "moses",
  "gautama buddha", "buddha", "krishna", "shiva", "vishnu", "yahweh", "allah", "god",
  "satan", "lucifer", "the pope", "pope",
] as const;

function termPattern(term: string): string {
  return term
    .split(/[\s-]+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s-]+");
}

const sensitivePattern = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${[...SENSITIVE_TERMS]
    .sort((left, right) => right.length - left.length)
    .map(termPattern)
    .join("|")})(?![\\p{L}\\p{N}_])`,
  "giu",
);

/** Replace configured mature/sensitive terms while leaving surrounding text intact. */
export function censorComicText(text: string): string {
  return text.replace(sensitivePattern, "***");
}

export function containsCensoredContent(text: string): boolean {
  return censorComicText(text) !== text;
}
