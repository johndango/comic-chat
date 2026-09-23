// Stand-alone demo for the ported layout engine (layout-demo.html).

import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "../avb";
import { analyzeMessage, selectPose } from "../emotion";
import { balloonFontMetrics, type BalloonMode } from "./balloon";
import { ComicPage, type ComicLine } from "./page";
import { canvasMeasurer, drawPanel } from "./render";

const CAST = [
  { id: "Connor", file: "connor.avb" },
  { id: "Jordan", file: "jordan.avb" },
  { id: "Tux", file: "tux.avb" },
  { id: "Glenda", file: "glenda.avb" },
];

const SCRIPT: [string, string, BalloonMode?][] = [
  ["Connor", "Hi everybody! Anyone here?"],
  ["Jordan", "Hey Connor! Welcome back."],
  ["Tux", "HELLO!!!"],
  ["Connor", "Jordan: did you see the new web version of Comic Chat?"],
  ["Jordan", "I did, it lays out balloons just like the old client :)"],
  ["Glenda", "waves at everyone", "action"],
  ["Tux", "I wonder if anyone remembers me", "think"],
  ["Glenda", "Tux: of course we do", "whisper"],
  [
    "Connor",
    "This is a deliberately long message that keeps going so that the balloon has to wrap onto several lines, and maybe even spill over into another panel with the three little dots that Comic Chat used for continuations.",
  ],
];

interface Loaded {
  buffer: ArrayBuffer;
  avatar: AvatarFile;
  poses: Map<number, Promise<HTMLCanvasElement>>;
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

function pose(id: string, index: number): Promise<HTMLCanvasElement> {
  const entry = cast.get(id)!;
  let pending = entry.poses.get(index);
  if (!pending) {
    pending = decodeImage(entry.buffer, entry.avatar.bodies[index].image, entry.avatar.palette).then(toCanvas);
    entry.poses.set(index, pending);
  }
  return pending;
}

async function lineFor(speakerId: string, raw: string, mode: BalloonMode = "say"): Promise<ComicLine> {
  // "Name: text" addresses Name, as Comic Chat did when you clicked a member.
  const match = raw.match(/^(\w+):\s*(.*)$/s);
  const target = match && CAST.find((c) => c.id.toLowerCase() === match[1].toLowerCase());
  talkTo.set(speakerId, target && target.id !== speakerId ? [target.id] : []);
  const text = target ? match![2] : raw;
  const bodies = cast.get(speakerId)!.avatar.bodies;
  const index = selectPose(bodies, analyzeMessage(text));
  const image = await pose(speakerId, index);
  return {
    speakerId,
    text,
    mode,
    pose: { width: image.width, height: image.height, faceX: bodies[index].x },
    poseRef: index,
  };
}

async function render(): Promise<void> {
  const measureContext = document.createElement("canvas").getContext("2d")!;
  const normal = balloonFontMetrics(canvasMeasurer(measureContext));
  const whisper = balloonFontMetrics(canvasMeasurer(measureContext, { italic: true }));
  const neutralIndex = (id: string) => selectPose(cast.get(id)!.avatar.bodies, analyzeMessage(""));
  const neutral = new Map<string, HTMLCanvasElement>();
  for (const { id } of CAST) neutral.set(id, await pose(id, neutralIndex(id)));

  // Replay the whole conversation; talkTos are per line, as the client tracked them.
  const replayTalkTo = new Map<string, string[]>();
  const page = new ComicPage({
    fonts: { normal, whisper },
    seed,
    talkTos: (id) => replayTalkTo.get(id) ?? [],
    neutralPose: (id) => {
      const image = neutral.get(id);
      if (!image) return undefined;
      const index = neutralIndex(id);
      return { pose: { width: image.width, height: image.height, faceX: cast.get(id)!.avatar.bodies[index].x }, poseRef: index };
    },
  });
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
      for (const body of layout.bodies) images.set(body.id, await pose(body.id, body.poseRef as number));
      const context = canvas.getContext("2d")!;
      context.scale(ratio, ratio);
      drawPanel(context, layout, { backdrop, body: (b) => images.get(b.id) }, { scale });
      return canvas;
    }),
  );
  strip.replaceChildren(...canvases);
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
    if (avatar.type !== AvatarType.Simple) throw new Error(`${file} is not a simple avatar`);
    cast.set(id, { buffer, avatar, poses: new Map() });
  }
  const room = await load("room.bgb");
  const roomFile = parseAvatar(room);
  if (roomFile.backdrop) backdrop = toCanvas(await decodeImage(room, roomFile.backdrop, roomFile.palette));

  const speaker = document.querySelector<HTMLSelectElement>("#speaker")!;
  speaker.replaceChildren(...CAST.map(({ id }) => new Option(id, id)));
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
