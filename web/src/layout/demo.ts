// Stand-alone demo for the ported layout engine (layout-demo.html).

import { decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "../avb";
import { bodyForText, composeChoice } from "../composite";
import { createEmotionWheel, posesForWheel } from "../emotion-wheel";
import type { PoseChoice } from "../expression";
import { newPoseMemory, type PoseMemory } from "../expression";
import { balloonFontMetrics, type BalloonMode } from "./balloon";
import { ComicPage, type ComicLine } from "./page";
import { canvasMeasurer, drawPanel, drawTitlePanel } from "./render";
import { layoutTitlePanel } from "./title";

const CAST = [
  { id: "Anna", file: "anna.avb" },
  { id: "Dan", file: "dan.avb" },
  { id: "Kirby", file: "kirby.avb" },
  { id: "Margaret", file: "margaret.avb" },
  { id: "Tux", file: "tux.avb" },
];

const SCRIPT: [string, string, BalloonMode?][] = [
  ["Anna", "Hi everybody! Anyone here?"],
  ["Dan", "Hi Anna! Welcome back :)"],
  ["Tux", "HELLO!!!"],
  ["Anna", "Dan: did you see the new web version of Comic Chat?"],
  ["Dan", "I did, it lays out balloons just like the old client :)"],
  ["Margaret", "waves at everyone", "action"],
  ["Kirby", "I wonder if anyone remembers me", "think"],
  ["Margaret", "Kirby: of course we do", "whisper"],
  ["Kirby", "That makes me so sad :("],
  [
    "Anna",
    "This is a deliberately long message that keeps going so that the balloon has to wrap onto several lines, and maybe even spill over into another panel with the three little dots that Comic Chat used for continuations.",
  ],
];

interface Loaded {
  buffer: ArrayBuffer;
  avatar: AvatarFile;
  poses: Map<string, HTMLCanvasElement>;
  memory: PoseMemory;
  icon?: HTMLCanvasElement;
}

const strip = document.querySelector<HTMLDivElement>("#strip")!;
const note = document.querySelector<HTMLParagraphElement>("#note")!;
const scale = 1 / 15; // 96 dpi
const cast = new Map<string, Loaded>();
const lines: ComicLine[] = [];
const talkTo = new Map<string, string[]>();
let backdrop: HTMLCanvasElement | undefined;
let seed = 1;

function toCanvas(bitmap: DecodedBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(bitmap.pixels), bitmap.width, bitmap.height), 0, 0);
  return canvas;
}

async function load(file: string): Promise<ArrayBuffer> {
  const response = await fetch(`/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.arrayBuffer();
}

/** Poses chosen on the emotion wheel, used for that character's next line (AF_TEMPFROZEN). */
const frozen = new Map<string, PoseChoice>();

async function poseFor(id: string, text: string, useWheel = false): Promise<{ image: HTMLCanvasElement; faceX: number; key: string }> {
  const entry = cast.get(id)!;
  const wheelChoice = useWheel ? frozen.get(id) : undefined;
  if (wheelChoice) frozen.delete(id);
  const body = wheelChoice
    ? await composeChoice(entry.buffer, entry.avatar, wheelChoice)
    : await bodyForText(entry.buffer, entry.avatar, text, entry.memory);
  let image = entry.poses.get(body.key);
  if (!image) {
    image = toCanvas(body.bitmap);
    entry.poses.set(body.key, image);
  }
  return { image, faceX: body.faceX, key: body.key };
}

async function lineFor(speakerId: string, raw: string, mode: BalloonMode = "say"): Promise<ComicLine> {
  // "Name: text" addresses Name, as Comic Chat did when you clicked a member.
  const match = raw.match(/^(\w+):\s*(.*)$/s);
  const target = match && CAST.find((c) => c.id.toLowerCase() === match[1].toLowerCase());
  talkTo.set(speakerId, target && target.id !== speakerId ? [target.id] : []);
  const text = target ? match![2] : raw;
  const { image, faceX, key } = await poseFor(speakerId, text, true);
  return { speakerId, text, mode, pose: { width: image.width, height: image.height, faceX }, poseRef: key };
}

async function render(): Promise<void> {
  const measureContext = document.createElement("canvas").getContext("2d")!;
  const normal = balloonFontMetrics(canvasMeasurer(measureContext));
  const whisper = balloonFontMetrics(canvasMeasurer(measureContext, { italic: true }));
  const neutral = new Map<string, Awaited<ReturnType<typeof poseFor>>>();
  for (const { id } of CAST) neutral.set(id, await poseFor(id, ""));

  // Replay the whole conversation; talkTos are per line, as the client tracked them.
  const replayTalkTo = new Map<string, string[]>();
  const page = new ComicPage({
    fonts: { normal, whisper },
    seed,
    talkTos: (id) => replayTalkTo.get(id) ?? [],
    neutralPose: (id) => {
      const n = neutral.get(id);
      return n && { pose: { width: n.image.width, height: n.image.height, faceX: n.faceX }, poseRef: n.key };
    },
  });
  const title = page.chooseTitle();
  for (const line of lines) {
    replayTalkTo.set(line.speakerId, (line as ComicLine & { talkTo: string[] }).talkTo);
    page.addLine(line);
  }

  const canvases = await Promise.all(
    page.layouts.map(async (layout) => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(layout.width * scale * ratio);
      canvas.height = Math.round(layout.height * scale * ratio);
      const images = new Map<string, HTMLCanvasElement>();
      for (const body of layout.bodies) images.set(body.id, cast.get(body.id)!.poses.get(body.poseRef as string)!);
      const context = canvas.getContext("2d")!;
      context.scale(ratio, ratio);
      drawPanel(context, layout, { backdrop, body: (b) => images.get(b.id) }, { scale });
      return canvas;
    }),
  );
  const titleCanvas = document.createElement("canvas");
  {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const titleMeasure = document.createElement("canvas").getContext("2d")!;
    const stars = CAST.map(({ id }, i) => ({
      id,
      nickname: id,
      sends: lines.filter((l) => l.speakerId === id).length,
      self: i === 0,
    }));
    const layout = layoutTitlePanel(title, stars, {
      measure: (text, height) => {
        titleMeasure.font = `${height}px "Comic Sans MS", "Comic Neue", cursive`;
        return titleMeasure.measureText(text).width;
      },
    });
    titleCanvas.width = Math.round(layout.width * scale * ratio);
    titleCanvas.height = Math.round(layout.height * scale * ratio);
    const context = titleCanvas.getContext("2d")!;
    context.scale(ratio, ratio);
    drawTitlePanel(context, layout, (id) => cast.get(id)?.icon, { scale });
  }
  strip.replaceChildren(titleCanvas, ...canvases);
  note.textContent = `${lines.length} lines → ${page.layouts.length} panels · seed ${seed}`;
}

async function addLine(speakerId: string, raw: string, mode?: BalloonMode): Promise<void> {
  const line = await lineFor(speakerId, raw, mode);
  lines.push(Object.assign(line, { talkTo: talkTo.get(speakerId) ?? [] }));
}

async function main(): Promise<void> {
  for (const { id, file } of CAST) {
    const buffer = await load(file);
    const avatar = parseAvatar(buffer);
    const icon = avatar.icon?.offset ? toCanvas(await decodeImage(buffer, avatar.icon, avatar.palette)) : undefined;
    cast.set(id, { buffer, avatar, poses: new Map(), memory: newPoseMemory(), icon });
  }
  const room = await load("room.bgb");
  const roomFile = parseAvatar(room);
  if (roomFile.backdrop) backdrop = toCanvas(await decodeImage(room, roomFile.backdrop, roomFile.palette));

  const speaker = document.querySelector<HTMLSelectElement>("#speaker")!;
  speaker.replaceChildren(...CAST.map(({ id }) => new Option(id, id)));

  // Emotion wheel + character preview, as in the 2.5 window's lower-right corner.
  const preview = document.createElement("canvas");
  preview.width = 120;
  preview.height = 159;
  preview.className = "preview";
  const showPreview = async (choice: PoseChoice) => {
    const entry = cast.get(speaker.value)!;
    const body = await composeChoice(entry.buffer, entry.avatar, choice);
    const context = preview.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, preview.width, preview.height);
    const k = Math.min(preview.width / body.bitmap.width, preview.height / body.bitmap.height);
    context.drawImage(toCanvas(body.bitmap), (preview.width - body.bitmap.width * k) / 2, preview.height - body.bitmap.height * k, body.bitmap.width * k, body.bitmap.height * k);
  };
  const wheelStatus = document.createElement("span");
  const wheel = createEmotionWheel({
    onChange: (emotion, name) => {
      const entry = cast.get(speaker.value)!;
      const choice = posesForWheel(entry.avatar, emotion, entry.memory);
      frozen.set(speaker.value, choice);
      wheelStatus.textContent = `Emotion is ${name} · used for ${speaker.value}'s next line`;
      void showPreview(choice);
    },
  });
  const tools = document.createElement("div");
  tools.className = "tools";
  tools.append(preview, wheel.element, wheelStatus);
  document.querySelector("header")!.append(tools);
  speaker.addEventListener("change", () => {
    wheel.set({ emotion: 0, intensity: 0 });
    frozen.delete(speaker.value);
    wheelStatus.textContent = "";
    const entry = cast.get(speaker.value)!;
    void showPreview(posesForWheel(entry.avatar, { emotion: 0, intensity: 0 }, entry.memory));
  });
  speaker.dispatchEvent(new Event("change"));
  document.querySelector<HTMLFormElement>("#say")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#text")!;
    const mode = document.querySelector<HTMLSelectElement>("#mode")!.value as BalloonMode;
    if (!input.value.trim()) return;
    await addLine(speaker.value, input.value.trim(), mode);
    input.value = "";
    await render();
  });
  document.querySelector<HTMLButtonElement>("#reseed")!.addEventListener("click", () => {
    seed = (seed * 7919 + 17) % 32768;
    void render();
  });

  for (const [id, text, mode] of SCRIPT) await addLine(id, text, mode);
  await render();
}

main().catch((error) => {
  note.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
