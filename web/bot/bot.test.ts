import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EM, emotionOptions } from "../src/expression";
import { BotBrain } from "./brain";
import { appearanceLine, IrcBot, splitForIrc } from "./irc";

const config = { nick: "BettyBot", siteUrl: "https://webcomicchat.com", schedule: "Chat nights are Fridays at 8pm ET." };
const T0 = 1_000_000;

describe("BotBrain greetings", () => {
  it("greets a newcomer once, and mentions the schedule when the room is empty", () => {
    const brain = new BotBrain(config);
    brain.handle({ type: "names", channel: "#webcomicchat", nicks: ["@BettyBot"], at: T0 });
    const out = brain.handle({ type: "join", channel: "#webcomicchat", nick: "Anna", at: T0 });
    expect(out[0].text).toMatch(/^Hi Anna! Welcome to the comic :\)/);
    expect(out[1].text).toContain("Fridays at 8pm ET");
    // Rejoining soon after: no second greeting.
    brain.handle({ type: "part", channel: "#webcomicchat", nick: "Anna", at: T0 + 1000 });
    expect(brain.handle({ type: "join", channel: "#webcomicchat", nick: "Anna", at: T0 + 60_000 })).toEqual([]);
  });

  it("says welcome back after a long absence", () => {
    const brain = new BotBrain(config);
    brain.handle({ type: "join", channel: "#c", nick: "Anna", at: T0 });
    const out = brain.handle({ type: "join", channel: "#c", nick: "Anna", at: T0 + 13 * 3_600_000 });
    expect(out[0].text).toBe("Hi Anna, welcome back :)");
  });

  it("spaces greetings out when many people arrive at once", () => {
    const brain = new BotBrain(config);
    const greeted = ["A1", "B2", "C3"].filter((nick, i) => brain.handle({ type: "join", channel: "#c", nick, at: T0 + i * 1000 }).length > 0);
    expect(greeted).toEqual(["A1"]);
  });

  it("doesn't greet itself or other bots", () => {
    const brain = new BotBrain({ ...config, ignore: ["Helper"] });
    for (const nick of ["BettyBot", "ChanServ", "WeatherBot", "helper"]) {
      expect(brain.handle({ type: "join", channel: "#c", nick, at: T0 })).toEqual([]);
    }
  });

  it("can skip greeting a human without ignoring their commands", () => {
    const brain = new BotBrain({ ...config, noGreet: ["Anna"] });
    expect(brain.handle({ type: "join", channel: "#c", nick: "anna", at: T0 })).toEqual([]);
    const [reply] = brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "BettyBot: help", at: T0 + 1000 });
    expect(reply.text).toContain("tips, show, title, fact, link, about");
  });

  it("doesn't mention the schedule when others are already there", () => {
    const brain = new BotBrain(config);
    brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "Dan"], at: T0 });
    const out = brain.handle({ type: "join", channel: "#c", nick: "Anna", at: T0 });
    expect(out).toHaveLength(1);
  });
});

describe("BotBrain answers", () => {
  it("answers only when addressed in a channel", () => {
    const brain = new BotBrain(config);
    expect(brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "help", at: T0 })).toEqual([]);
    const out = brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "BettyBot: help", at: T0 });
    expect(out[0].target).toBe("#c");
    expect(out[0].text).toContain("tips, show, title, fact, link, about");
  });

  it("answers private messages privately", () => {
    const brain = new BotBrain(config);
    const [reply] = brain.handle({ type: "message", channel: null, nick: "Anna", text: "link", at: T0 });
    expect(reply).toMatchObject({ target: "Anna", text: "Bring friends: https://webcomicchat.com" });
  });

  it("cycles through tips and admits to being a bot", () => {
    const brain = new BotBrain(config);
    const first = brain.answer("tips", "Anna");
    const second = brain.answer("tips", "Anna");
    expect(first).not.toBe(second);
    expect(brain.answer("are you a bot?", "Anna")).toMatch(/Yes, I'm a bot/);
  });

  it("never echoes what people typed", () => {
    const brain = new BotBrain(config);
    const [reply] = brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "BettyBot: say I am evil", at: T0 });
    expect(reply.text).not.toContain("evil");
  });

  it("answers every command for someone exploring, then pauses once for a spammer", () => {
    const brain = new BotBrain(config);
    const ask = (text: string, i: number) =>
      brain.handle({ type: "message", channel: "#c", nick: "Anna", text: `BettyBot: ${text}`, at: T0 + i * 5000 })[0]?.text;
    const replies = ["help", "tips", "link", "about", "schedule", "are you a bot", "help", "help", "help"].map(ask);
    expect(replies[3]).toMatch(/Comic Chat did in 1996/);
    expect(replies[4]).toMatch(/Fridays at 8pm ET/);
    expect(replies[5]).toMatch(/I'm a bot/);
    expect(replies[6]).toMatch(/^Catching my breath, Anna/);
    expect(replies.slice(7)).toEqual([undefined, undefined]);
    // A minute later the limit has reset.
    expect(brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "BettyBot: link", at: T0 + 120_000 })[0]?.text).toMatch(/^Bring friends/);
  });

  it("gives a useful schedule answer when none is configured", () => {
    const brain = new BotBrain({ nick: "BettyBot", siteUrl: "https://webcomicchat.com" });
    expect(brain.answer("schedule", "Anna")).toMatch(/announcing a special weekly meetup soon/);
  });

  it("ignores other bots' messages", () => {
    const brain = new BotBrain(config);
    expect(brain.handle({ type: "message", channel: "#c", nick: "OtherBot", text: "BettyBot: help", at: T0 })).toEqual([]);
  });
});

describe("BotBrain company for a lone visitor", () => {
  it("speaks up once if someone talks to an empty room", () => {
    const brain = new BotBrain(config);
    brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "Anna"], at: T0 });
    brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "anyone here?", at: T0 });
    expect(brain.handle({ type: "tick", at: T0 + 60_000 })).toEqual([]);
    const [nudge] = brain.handle({ type: "tick", at: T0 + 4 * 60_000 });
    expect(nudge.text).toMatch(/^Nobody else is around just now, Anna/);
    brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "hello?", at: T0 + 5 * 60_000 });
    expect(brain.handle({ type: "tick", at: T0 + 10 * 60_000 })).toEqual([]);
  });

  it("stays quiet when another person is there to answer", () => {
    const brain = new BotBrain(config);
    brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "Anna", "Dan"], at: T0 });
    brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "anyone here?", at: T0 });
    expect(brain.handle({ type: "tick", at: T0 + 10 * 60_000 })).toEqual([]);
  });
});

describe("splitForIrc", () => {
  it("keeps lines under the IRC limit and strips line breaks", () => {
    const pieces = splitForIrc(`${"word ".repeat(200)}\r\nQUIT`);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(Buffer.byteLength(p)).toBeLessThanOrEqual(400);
      expect(p).not.toMatch(/[\r\n]/);
    }
  });

  it("formats only safe Comic Chat character announcements", () => {
    expect(appearanceLine("Anna")).toBe("# Appears as Anna");
    expect(appearanceLine("Pip", "https://webcomicchat.com/art/pip.avb")).toBe(
      "# Appears as Pip.https://webcomicchat.com/art/pip.avb",
    );
    expect(() => appearanceLine("bad name")).toThrow("avatar name");
    expect(() => appearanceLine("Pip", "http://example.com/pip.avb")).toThrow("HTTPS");
  });
});

describe("IrcBot against a fake server", () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it("registers, marks itself as a bot, joins, answers PING and paces messages", async () => {
    const received: string[] = [];
    let client: Socket | undefined;
    const server = createServer((socket) => {
      client = socket;
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let i = buffer.indexOf("\r\n");
        while (i >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          received.push(line);
          if (line.startsWith("USER ")) {
            socket.write(":irc.test 001 BettyBot :Welcome\r\n");
            socket.write("PING :abc123\r\n");
          }
          if (line.startsWith("JOIN #c")) {
            socket.write(":BettyBot!b@h JOIN #c\r\n:irc.test 353 BettyBot = #c :BettyBot Anna\r\n:irc.test 366 BettyBot #c :End\r\n");
            socket.write(":Anna!a@h PRIVMSG #c :# Appears as Connor\r\n");
            socket.write(":Anna!a@h PRIVMSG #c :BettyBot: help\r\n");
          }
          i = buffer.indexOf("\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const events: string[] = [];
    const bot = new IrcBot(
      { host: "127.0.0.1", port, tls: false, nick: "BettyBot", realname: "test bot", channels: ["#c"], avatar: { name: "Anna" }, pace: 200 },
      {
        onNames: (channel, nicks) => events.push(`names ${channel} ${nicks.join(",")}`),
        onMessage: (channel, nick, text) => {
          events.push(`msg ${channel} ${nick} ${text}`);
          bot.say("#c", "one");
          bot.say("#c", "two");
        },
      },
    );
    close = () => {
      bot.stop();
      client?.destroy();
      server.close();
    };
    bot.start();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(received).toContain("NICK BettyBot");
    expect(received).toContain("MODE BettyBot +B");
    expect(received).toContain("JOIN #c");
    expect(received).toContain("PONG :abc123");
    expect(events).toEqual(["names #c BettyBot,Anna", "msg #c Anna BettyBot: help"]);
    const sent = received.filter((l) => l.startsWith("PRIVMSG"));
    expect(sent).toEqual([
      "PRIVMSG #c :# Appears as Anna",
      "PRIVMSG Anna :# Appears as Anna",
      "PRIVMSG #c :one",
      "PRIVMSG #c :two",
    ]);
  });
});

describe("show, title and fact", () => {
  const strongest = (text: string) => [...emotionOptions(text)].sort((a, b) => b.priority - a.priority)[0]?.emotion;

  it.each([
    ["shout", EM.SHOUT],
    ["laugh", EM.LAUGH],
    ["happy", EM.HAPPY],
    ["sad", EM.SAD],
    ["coy", EM.COY],
    ["wave", EM.WAVE],
    ["point", EM.POINTOTHER],
    ["self", EM.POINTSELF],
  ])("show %s makes Betty's character act it out under the original rules", (what, emotion) => {
    const brain = new BotBrain(config);
    const line = brain.answer(`show ${what}`, "Anna");
    expect(strongest(line)).toBe(emotion);
  });

  it("show understands casual phrasing and explains wheel-only expressions", () => {
    const brain = new BotBrain(config);
    expect(strongest(brain.answer("show me a smile", "Anna"))).toBe(EM.HAPPY);
    expect(brain.answer("show angry", "Anna")).toMatch(/emotion wheel/);
    expect(brain.answer("show", "Anna")).toMatch(/shout, laugh, happy/);
    expect(brain.answer("show banana", "Anna")).toMatch(/^I can show/);
  });

  it("title picks one of the 16 original titles", () => {
    const first = new BotBrain(config, () => 0).answer("title", "Anna");
    const last = new BotBrain(config, () => 0.999).answer("title", "Anna");
    expect(first).toBe(`Tonight's comic is called "EVERYONE'S A COMIC"`);
    expect(last).toBe(`Tonight's comic is called "MICROSOFT CHAT"`);
  });

  it("fact cycles through history without repeating until all are told", () => {
    const brain = new BotBrain(config);
    const facts = Array.from({ length: 12 }, () => brain.answer("fact", "Anna"));
    expect(new Set(facts).size).toBe(12);
    expect(facts[0]).toMatch(/Microsoft Research/);
    expect(brain.answer("tell me some trivia", "Anna")).toBe(facts[0]);
  });

  it("help lists the new commands", () => {
    expect(new BotBrain(config).answer("help", "Anna")).toMatch(/tips, show, title, fact/);
  });
});

describe("about mentions the AI bot while it's present", () => {
  const withFriend = { ...config, aiFriend: "TongueTiedBot" };
  const ask = (brain: BotBrain) => brain.handle({ type: "message", channel: "#c", nick: "Anna", text: "BettyBot: about", at: T0 })[0].text;

  it("explains how to talk to TongueTiedBot when it's in the room", () => {
    const brain = new BotBrain(withFriend);
    brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "TongueTiedBot", "Anna"], at: T0 });
    const text = ask(brain);
    expect(text).toMatch(/Comic Chat did in 1996/);
    expect(text).toMatch(/TongueTiedBot is here too/);
    expect(text).toMatch(/start a line with "TongueTiedBot:"/);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(400);
  });

  it("stops advertising the AI bot after quit, nick change, disconnect, or a refreshed member list", () => {
    const removals = [
      (brain: BotBrain) => brain.handle({ type: "quit", nick: "tonguetiedbot", at: T0 }),
      (brain: BotBrain) => brain.handle({ type: "nick", oldNick: "TongueTiedBot", newNick: "Away", at: T0 }),
      (brain: BotBrain) => brain.handle({ type: "disconnect", at: T0 }),
      (brain: BotBrain) => brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "Anna"], at: T0 }),
    ];
    for (const remove of removals) {
      const brain = new BotBrain(withFriend);
      brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "TongueTiedBot", "Anna"], at: T0 });
      remove(brain);
      expect(ask(brain)).not.toContain("TongueTiedBot is here too");
    }
  });

  it("leaves it out when the AI bot isn't there", () => {
    const brain = new BotBrain(withFriend);
    brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "Anna"], at: T0 });
    expect(ask(brain)).not.toMatch(/TongueTiedBot/);
  });

  it("notices the AI bot leaving", () => {
    const brain = new BotBrain(withFriend);
    brain.handle({ type: "names", channel: "#c", nicks: ["BettyBot", "TongueTiedBot", "Anna"], at: T0 });
    brain.handle({ type: "part", channel: "#c", nick: "TongueTiedBot", at: T0 });
    expect(ask(brain)).not.toMatch(/TongueTiedBot/);
  });
});
