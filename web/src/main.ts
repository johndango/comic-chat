import "./styles.css";
import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "./avb";
import { PanelRenderer } from "./panel";

const characters = [
  { file: "connor.avb", label: "Connor" },
  { file: "glenda.avb", label: "Glenda" },
  { file: "jordan.avb", label: "Jordan" },
  { file: "pedagog.avb", label: "Pedagog" },
  { file: "rainbow.avb", label: "Rainbow" },
  { file: "tux.avb", label: "Tux" },
  { file: "waf.avb", label: "Waf" },
];

const backdrops = [
  { file: "room.bgb", label: "The room" },
  { file: "space.bgb", label: "Deep space" },
  { file: "clouds.bgb", label: "Clouds" },
  { file: "field.bgb", label: "The field" },
  { file: "pastoral.bgb", label: "Pastoral" },
  { file: "yellow.bgb", label: "Yellow" },
  { file: "buckroom.bgb", label: "Buck's room" },
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application mount point is missing");

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Comic Chat prototype home">
      <span class="brand-burst">CC!</span>
      <span><strong>Comic Chat</strong><small>web lab / issue no. 001</small></span>
    </a>
    <span class="prototype-stamp">local prototype</span>
  </header>
  <main>
    <section class="intro">
      <p class="eyebrow">A 1990s chat experiment, back in the browser</p>
      <h1>Make one panel.<br /><em>Say it like a comic.</em></h1>
      <p class="lede">This first slice reads the original <code>.avb</code> and <code>.bgb</code> files right in your browser. No uploads. No server. Just the old artwork in a new shell.</p>
    </section>
    <section class="workspace" aria-label="Comic panel editor">
      <aside class="controls">
        <div class="step"><span>1</span><label for="character">Choose a character</label></div>
        <select id="character">${characters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>

        <div class="step"><span>2</span><label for="backdrop">Pick a scene</label></div>
        <select id="backdrop">${backdrops.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>

        <div class="step"><span>3</span><label for="message">Write the line</label></div>
        <textarea id="message" maxlength="180" rows="5">The web? Sure. But make it a comic.</textarea>
        <div class="count"><span id="count">38</span> / 180</div>

        <div class="pose-control">
          <button id="previous-pose" class="square-button" type="button" aria-label="Previous pose">←</button>
          <span><small>character pose</small><strong id="pose-label">1 / 1</strong></span>
          <button id="next-pose" class="square-button" type="button" aria-label="Next pose">→</button>
        </div>

        <button id="download" class="download-button" type="button">Download panel <span>↘</span></button>
        <p id="status" class="status" role="status">Loading original art…</p>
      </aside>
      <div class="stage-wrap">
        <div class="tape tape-one"></div><div class="tape tape-two"></div>
        <canvas id="panel" aria-label="Comic panel preview"></canvas>
        <p class="stage-caption">Rendered locally from the repository's original art files.</p>
      </div>
    </section>
  </main>
  <footer>
    <span>Proof of concept · browser only · no chat transport yet</span>
    <span>Microsoft Comic Chat is an open-source archival code release.</span>
  </footer>
`;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element: ${selector}`);
  return value;
}

const canvas = element<HTMLCanvasElement>("#panel");
const characterSelect = element<HTMLSelectElement>("#character");
const backdropSelect = element<HTMLSelectElement>("#backdrop");
const messageInput = element<HTMLTextAreaElement>("#message");
const poseLabel = element<HTMLElement>("#pose-label");
const countLabel = element<HTMLElement>("#count");
const status = element<HTMLElement>("#status");
const previousButton = element<HTMLButtonElement>("#previous-pose");
const nextButton = element<HTMLButtonElement>("#next-pose");
const renderer = new PanelRenderer(canvas);

let avatarBuffer: ArrayBuffer;
let avatar: AvatarFile;
let backdropBitmap: DecodedBitmap;
let characterBitmap: DecodedBitmap;
let poseIndex = 0;
let characterGeneration = 0;
let backdropGeneration = 0;
let poseGeneration = 0;

async function fetchAsset(file: string): Promise<ArrayBuffer> {
  const response = await fetch(`/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.arrayBuffer();
}

function render(): void {
  if (!avatar || !backdropBitmap || !characterBitmap) return;
  renderer.render({
    backdrop: backdropBitmap,
    character: characterBitmap,
    characterName: avatar.name || characterSelect.selectedOptions[0].text,
    message: messageInput.value,
  });
}

function setStatus(message: string): void {
  status.textContent = message;
  status.classList.remove("error");
}

async function loadCharacter(): Promise<void> {
  const currentGeneration = ++characterGeneration;
  setStatus("Decoding character…");
  const buffer = await fetchAsset(characterSelect.value);
  const parsed = parseAvatar(buffer);
  if (parsed.type !== AvatarType.Simple || parsed.bodies.length === 0) {
    throw new Error("This prototype currently expects a simple avatar");
  }
  if (currentGeneration !== characterGeneration) return;
  avatarBuffer = buffer;
  avatar = parsed;
  poseIndex = 0;
  await loadPose();
}

async function loadPose(): Promise<void> {
  const currentGeneration = ++poseGeneration;
  const pose = avatar.bodies[poseIndex];
  const bitmap = await decodeImage(avatarBuffer, pose.image, avatar.palette);
  if (currentGeneration !== poseGeneration) return;
  characterBitmap = bitmap;
  poseLabel.textContent = `${poseIndex + 1} / ${avatar.bodies.length}`;
  setStatus(`${avatar.name || "Character"} decoded · ${bitmap.width}×${bitmap.height}px source art`);
  render();
}

async function loadBackdrop(): Promise<void> {
  const currentGeneration = ++backdropGeneration;
  setStatus("Decoding backdrop…");
  const buffer = await fetchAsset(backdropSelect.value);
  const parsed = parseAvatar(buffer);
  if (parsed.type !== AvatarType.Backdrop || !parsed.backdrop) {
    throw new Error("This is not a Comic Chat backdrop");
  }
  const bitmap = await decodeImage(buffer, parsed.backdrop, parsed.palette);
  if (currentGeneration !== backdropGeneration) return;
  backdropBitmap = bitmap;
  setStatus(`Backdrop decoded · ${bitmap.width}×${bitmap.height}px source art`);
  render();
}

async function initialLoad(): Promise<void> {
  try {
    const [characterBuffer, backgroundBuffer] = await Promise.all([
      fetchAsset(characterSelect.value),
      fetchAsset(backdropSelect.value),
    ]);
    avatarBuffer = characterBuffer;
    avatar = parseAvatar(characterBuffer);
    const background = parseAvatar(backgroundBuffer);
    if (!avatar.bodies[0] || !background.backdrop) throw new Error("The selected art is incomplete");
    [characterBitmap, backdropBitmap] = await Promise.all([
      decodeImage(characterBuffer, avatar.bodies[0].image, avatar.palette),
      decodeImage(backgroundBuffer, background.backdrop, background.palette),
    ]);
    poseLabel.textContent = `1 / ${avatar.bodies.length}`;
    setStatus("Original art decoded in your browser.");
    render();
  } catch (error) {
    showError(error);
  }
}

function showError(error: unknown): void {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : "Something went wrong";
  status.classList.add("error");
}

characterSelect.addEventListener("change", () => loadCharacter().catch(showError));
backdropSelect.addEventListener("change", () => loadBackdrop().catch(showError));
messageInput.addEventListener("input", () => {
  countLabel.textContent = String(messageInput.value.length);
  render();
});
previousButton.addEventListener("click", () => {
  poseIndex = (poseIndex - 1 + avatar.bodies.length) % avatar.bodies.length;
  loadPose().catch(showError);
});
nextButton.addEventListener("click", () => {
  poseIndex = (poseIndex + 1) % avatar.bodies.length;
  loadPose().catch(showError);
});
element<HTMLButtonElement>("#download").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = `comic-chat-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

void initialLoad();
