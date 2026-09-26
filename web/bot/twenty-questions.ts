// 20 questions, hosted by TongueTiedBot for the whole room. The code keeps the
// secret, counts questions and checks guesses; the model only answers each
// yes-or-no question in character. So the answer can't drift mid-game, and a
// right guess is recognised even if the model would have fumbled it.

export interface Secret {
  /** How it's revealed: "a floppy disk". */
  answer: string;
  /** The opening hint: "an object". */
  kind: string;
  /** Words that count as a right guess (checked as whole words). */
  names: string[];
}

// Family-friendly, mostly 90s and old-internet, all guessable in 20.
export const SECRETS: readonly Secret[] = [
  { answer: "a floppy disk", kind: "an object", names: ["floppy disk", "floppy", "diskette"] },
  { answer: "a Tamagotchi", kind: "a toy", names: ["tamagotchi", "virtual pet"] },
  { answer: "a dial-up modem", kind: "a gadget", names: ["modem", "dial-up", "dial up"] },
  { answer: "a lava lamp", kind: "an object", names: ["lava lamp"] },
  { answer: "a Game Boy", kind: "a gadget", names: ["game boy", "gameboy"] },
  { answer: "a pager", kind: "a gadget", names: ["pager", "beeper"] },
  { answer: "a VHS tape", kind: "an object", names: ["vhs", "videotape", "video tape", "vcr tape"] },
  { answer: "a Walkman", kind: "a gadget", names: ["walkman", "cassette player"] },
  { answer: "a slap bracelet", kind: "a toy", names: ["slap bracelet", "snap bracelet"] },
  { answer: "a Furby", kind: "a toy", names: ["furby"] },
  { answer: "a disposable camera", kind: "an object", names: ["disposable camera"] },
  { answer: "a computer mouse", kind: "an object", names: ["mouse"] },
  { answer: "a CD-ROM", kind: "an object", names: ["cd-rom", "cd rom", "cdrom", "compact disc"] },
  { answer: "a joystick", kind: "an object", names: ["joystick"] },
  { answer: "a Rubik's Cube", kind: "a toy", names: ["rubik's cube", "rubiks cube", "rubik cube", "rubik's"] },
  { answer: "a yo-yo", kind: "a toy", names: ["yo-yo", "yoyo", "yo yo"] },
  { answer: "a skateboard", kind: "an object", names: ["skateboard"] },
  { answer: "a pizza", kind: "a food", names: ["pizza"] },
  { answer: "a banana", kind: "a food", names: ["banana"] },
  { answer: "a donut", kind: "a food", names: ["donut", "doughnut"] },
  { answer: "popcorn", kind: "a food", names: ["popcorn"] },
  { answer: "a penguin", kind: "an animal", names: ["penguin"] },
  { answer: "a giraffe", kind: "an animal", names: ["giraffe"] },
  { answer: "a goldfish", kind: "an animal", names: ["goldfish"] },
  { answer: "an octopus", kind: "an animal", names: ["octopus"] },
  { answer: "a hamster", kind: "an animal", names: ["hamster"] },
  { answer: "a dinosaur", kind: "an animal", names: ["dinosaur", "t-rex", "t rex", "trex"] },
  { answer: "a kangaroo", kind: "an animal", names: ["kangaroo"] },
  { answer: "the Moon", kind: "a place", names: ["moon"] },
  { answer: "a volcano", kind: "a place", names: ["volcano"] },
  { answer: "a lighthouse", kind: "a place", names: ["lighthouse"] },
  { answer: "an arcade", kind: "a place", names: ["arcade"] },
  { answer: "a library", kind: "a place", names: ["library"] },
  { answer: "a rainbow", kind: "a thing in nature", names: ["rainbow"] },
  { answer: "a snowman", kind: "a thing", names: ["snowman", "snow man"] },
  { answer: "a comic book", kind: "an object", names: ["comic book"] },
  { answer: "a speech balloon", kind: "a thing", names: ["speech balloon", "speech bubble", "word balloon"] },
  { answer: "a hot air balloon", kind: "a vehicle", names: ["hot air balloon", "hot-air balloon"] },
  { answer: "a submarine", kind: "a vehicle", names: ["submarine"] },
  { answer: "a roller coaster", kind: "a thing", names: ["roller coaster", "rollercoaster"] },
  { answer: "a trampoline", kind: "an object", names: ["trampoline"] },
  { answer: "an umbrella", kind: "an object", names: ["umbrella"] },
];

export const TOTAL_QUESTIONS = 20;
/** A game nobody has touched for this long ends with a reveal. */
export const GAME_IDLE_MS = 15 * 60_000;

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
const mentions = (text: string, name: string) => words(text).includes(words(name));

export const START_GAME = /^(?:(?:ok(?:ay)?|hey|so)\s+)?(?:let'?s\s+)?(?:play\s+)?(?:a\s+(?:game\s+of\s+)?)?(?:20|twenty)[\s-]*(?:q|qs|questions?)\b|^(?:let'?s\s+play|wanna\s+play|play\s+(?:a\s+)?game)\b/i;
export const GIVE_UP = /^(?:i\s+|we\s+)?(?:give\s+up|surrender|end\s+(?:the\s+)?game|quit(?:\s+(?:the\s+)?game)?|tell\s+(?:me|us)(?:\s+the\s+answer)?|what\s+(?:was|is)\s+it)\b/i;
/** Answers to the invite that don't need the bot's name: "yes!", "me", "I'll play". */
export const ACCEPT_INVITE = /^(?:yes+|yeah|yep|yup|sure|ok(?:ay)?|me+|me too|i'?ll play|i'?m in|let'?s (?:play|do it)|count me in)[\s!.:)]*$/i;

export class TwentyQuestionsGame {
  asked = 0;
  lastAt: number;
  readonly history: Array<{ question: string; answer: string }> = [];

  constructor(readonly secret: Secret, readonly startedAt: number) {
    this.lastAt = startedAt;
  }

  get remaining(): number {
    return TOTAL_QUESTIONS - this.asked;
  }

  /** Does this line name the secret? */
  guessedBy(text: string): boolean {
    return this.secret.names.some((name) => mentions(text, name));
  }

  /** Would this reply give the answer away? */
  leaks(text: string): boolean {
    return this.guessedBy(text);
  }

  /** What the model is given for one question: the secret, the game so far, and the (escaped) question. */
  prompt(nick: string, question: string): string {
    const past = this.history.slice(-8).map((turn) => `${JSON.stringify(turn.question)} -> ${JSON.stringify(turn.answer)}`).join("\n");
    return [
      `<game>You are hosting 20 questions for the whole room. The secret answer is ${JSON.stringify(this.secret.answer)} (${this.secret.kind}). Never say it, spell it, or hint at it directly.`,
      "Answer the latest question truthfully about the secret. Start with exactly one of: Yes, No, Sort of, Sometimes, I don't know, or Not a yes-or-no question. You may add a few friendly words after it. Under 100 characters. Stay consistent with earlier answers.",
      "If the question guesses a different specific thing, answer No.",
      past ? `Earlier questions and answers:\n${past}` : "No questions yet.",
      "</game>",
      `<question from=${JSON.stringify(nick).replace(/</g, "\\u003c")}>${JSON.stringify(question).replace(/</g, "\\u003c")}</question>`,
    ].join("\n");
  }
}

/** The model's reply → the text to post, and whether it used up a question. */
export function readAnswer(reply: string): { text: string; counted: boolean } {
  const text = reply.replace(/\s+/g, " ").trim().slice(0, 140);
  const counted = /^(?:yes|no|sort of|sometimes|i don['’]?t know)\b/i.test(text)
    && !/^not a yes[\s-]*or[\s-]*no question/i.test(text);
  return { text, counted };
}

export function pickSecret(random: () => number): Secret {
  return SECRETS[Math.min(SECRETS.length - 1, Math.floor(random() * SECRETS.length))];
}

export const INVITES = [
  "Anyone up for 20 questions? I'm thinking of something... say \"yes\" to play!",
  "Quiet in here! Want to play 20 questions with me? Say \"me\" and I'll think of something :)",
  "I've got something in mind. 20 questions, anyone? Just say \"yes\"!",
];
