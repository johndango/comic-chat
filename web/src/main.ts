import "./styles.css";
import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "./avb";
import { analyzeMessage, selectPose, type EmotionResult } from "./emotion";
import { PANEL_HEIGHT, PANEL_WIDTH, PanelRenderer } from "./panel";

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

const MAX_PANELS = 12;

interface LoadedAvatar {
  buffer: ArrayBuffer;
  metadata: AvatarFile;
}

interface ConversationPanel {
  characterFile: string;
  characterName: string;
  character: DecodedBitmap;
  emotion: EmotionResult;
  message: string;
  poseIndex: number;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application mount point is missing");

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Comic Chat prototype home">
      <span class="brand-burst">CC!</span>
      <span><strong>Comic Chat</strong><small>web lab / issue no. 002</small></span>
    </a>
    <span class="prototype-stamp">conversation build</span>
  </header>
  <main>
    <section class="intro">
      <p class="eyebrow">The words direct the cast — just like the 1998 client</p>
      <h1>Build a chat.<br /><em>Watch it become a comic.</em></h1>
      <p class="lede">Add lines to a strip and the original Comic Chat rules choose each character's expression. Greetings wave. Emoticons smile. “LOL” actually gets a laugh.</p>
    </section>
    <section class="workspace" aria-label="Comic conversation editor">
      <aside class="controls">
        <div class="step"><span>1</span><label for="character">Choose the speaker</label></div>
        <select id="character">${characters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>

        <div class="step"><span>2</span><label for="backdrop">Set the scene</label></div>
        <select id="backdrop">${backdrops.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>

        <div class="step"><span>3</span><label for="message">Write the next line</label></div>
        <textarea id="message" maxlength="180" rows="4" placeholder="Try: Hello there! or LOL!!!"></textarea>
        <div class="count"><span id="count">0</span> / 180</div>

        <div class="tone-card" aria-live="polite">
          <span class="tone-icon">✦</span>
          <span><small>automatic expression</small><strong id="tone-value">Neutral</strong><em id="tone-reason">No expression cues</em></span>
        </div>

        <button id="add-panel" class="add-button" type="button" disabled>Add panel to strip <span>＋</span></button>

        <div class="strip-actions">
          <button id="undo-panel" class="small-action" type="button">Undo last</button>
          <button id="clear-strip" class="small-action" type="button">Clear strip</button>
        </div>
        <button id="download" class="download-button" type="button" disabled>Download strip <span>↘</span></button>
        <p id="status" class="status" role="status">Loading original art…</p>
      </aside>
      <div class="stage-wrap conversation-stage">
        <div class="strip-heading">
          <span>Your conversation</span>
          <strong id="strip-count">0 panels</strong>
        </div>
        <div id="strip" class="comic-strip" aria-live="polite"></div>
        <p class="stage-caption">Expressions are selected from rules found in the original 2.5 source.</p>
      </div>
    </section>
  </main>
  <footer>
    <span>Proof of concept · browser only · no chat transport yet</span>
    <span>Original avatar metadata + original text-expression rules</span>
  </footer>
`;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element: ${selector}`);
  return value;
}

const characterSelect = element<HTMLSelectElement>("#character");
const backdropSelect = element<HTMLSelectElement>("#backdrop");
const messageInput = element<HTMLTextAreaElement>("#message");
const countLabel = element<HTMLElement>("#count");
const toneValue = element<HTMLElement>("#tone-value");
const toneReason = element<HTMLElement>("#tone-reason");
const strip = element<HTMLElement>("#strip");
const stripCount = element<HTMLElement>("#strip-count");
const status = element<HTMLElement>("#status");
const addButton = element<HTMLButtonElement>("#add-panel");
const undoButton = element<HTMLButtonElement>("#undo-panel");
const clearButton = element<HTMLButtonElement>("#clear-strip");
const downloadButton = element<HTMLButtonElement>("#download");

const avatarCache = new Map<string, Promise<LoadedAvatar>>();
const poseCache = new Map<string, Promise<DecodedBitmap>>();
const conversation: ConversationPanel[] = [];
let panelCanvases: HTMLCanvasElement[] = [];
let backdropBitmap: DecodedBitmap;
let backdropGeneration = 0;
let isAdding = false;

async function fetchAsset(file: string): Promise<ArrayBuffer> {
  const response = await fetch(`/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.arrayBuffer();
}

function loadAvatar(file: string): Promise<LoadedAvatar> {
  const cached = avatarCache.get(file);
  if (cached) return cached;
  const pending = fetchAsset(file).then((buffer) => {
    const metadata = parseAvatar(buffer);
    if (metadata.type !== AvatarType.Simple || metadata.bodies.length === 0) {
      throw new Error(`${file} is not a supported simple avatar`);
    }
    return { buffer, metadata };
  });
  avatarCache.set(file, pending);
  return pending;
}

function loadPose(file: string, avatar: LoadedAvatar, poseIndex: number): Promise<DecodedBitmap> {
  const key = `${file}:${poseIndex}`;
  const cached = poseCache.get(key);
  if (cached) return cached;
  const pending = decodeImage(
    avatar.buffer,
    avatar.metadata.bodies[poseIndex].image,
    avatar.metadata.palette,
  );
  poseCache.set(key, pending);
  return pending;
}

async function createConversationPanel(characterFile: string, message: string): Promise<ConversationPanel> {
  const avatar = await loadAvatar(characterFile);
  const emotion = analyzeMessage(message);
  const poseIndex = selectPose(avatar.metadata.bodies, emotion);
  const character = await loadPose(characterFile, avatar, poseIndex);
  return {
    characterFile,
    characterName: characters.find(({ file }) => file === characterFile)?.label || avatar.metadata.name || "Character",
    character,
    emotion,
    message,
    poseIndex,
  };
}

function setStatus(message: string): void {
  status.textContent = message;
  status.classList.remove("error");
}

function showError(error: unknown): void {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : "Something went wrong";
  status.classList.add("error");
}

function updateControls(): void {
  const emotion = analyzeMessage(messageInput.value);
  countLabel.textContent = String(messageInput.value.length);
  toneValue.textContent = emotion.label;
  toneReason.textContent = emotion.reason;
  addButton.disabled = isAdding || messageInput.value.trim().length === 0 || conversation.length >= MAX_PANELS;
  undoButton.disabled = conversation.length === 0 || isAdding;
  clearButton.disabled = conversation.length === 0 || isAdding;
  downloadButton.disabled = conversation.length === 0 || isAdding;
}

function renderStrip(): void {
  strip.replaceChildren();
  panelCanvases = [];

  if (conversation.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-strip";
    empty.innerHTML = `<span>01</span><strong>Your next line starts the strip.</strong><p>The character's pose will be chosen automatically.</p>`;
    strip.append(empty);
  }

  conversation.forEach((panel, index) => {
    const card = document.createElement("article");
    card.className = "panel-card";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `Panel ${index + 1}: ${panel.characterName} says ${panel.message}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-panel";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove panel ${index + 1}`);
    remove.addEventListener("click", () => {
      conversation.splice(index, 1);
      renderStrip();
      updateControls();
      setStatus("Panel removed from the strip.");
    });
    const metadata = document.createElement("p");
    metadata.className = "panel-meta";
    metadata.textContent = `${panel.emotion.label} · pose ${panel.poseIndex + 1}`;
    card.append(canvas, remove, metadata);
    strip.append(card);
    new PanelRenderer(canvas).render({
      backdrop: backdropBitmap,
      character: panel.character,
      characterName: panel.characterName,
      characterSide: index % 2 === 0 ? "left" : "right",
      emotionLabel: panel.emotion.label,
      message: panel.message,
      panelNumber: index + 1,
    });
    panelCanvases.push(canvas);
  });

  stripCount.textContent = `${conversation.length} ${conversation.length === 1 ? "panel" : "panels"}`;
  updateControls();
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
  renderStrip();
  setStatus(`Scene changed · ${bitmap.width}×${bitmap.height}px original art`);
}

function advanceSpeaker(): void {
  characterSelect.selectedIndex = (characterSelect.selectedIndex + 1) % characterSelect.options.length;
}

async function addPanel(): Promise<void> {
  const message = messageInput.value.trim();
  if (!message || conversation.length >= MAX_PANELS || isAdding) return;
  isAdding = true;
  updateControls();
  setStatus("Reading the line and choosing a pose…");
  try {
    const panel = await createConversationPanel(characterSelect.value, message);
    conversation.push(panel);
    messageInput.value = "";
    advanceSpeaker();
    renderStrip();
    setStatus(`${panel.characterName}: ${panel.emotion.label.toLowerCase()} · pose ${panel.poseIndex + 1}`);
  } finally {
    isAdding = false;
    updateControls();
  }
}

function downloadStrip(): void {
  if (panelCanvases.length === 0) return;
  const columns = panelCanvases.length === 1 ? 1 : 2;
  const rows = Math.ceil(panelCanvases.length / columns);
  const output = document.createElement("canvas");
  output.width = PANEL_WIDTH * columns;
  output.height = PANEL_HEIGHT * rows;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = "#f4efe3";
  context.fillRect(0, 0, output.width, output.height);
  panelCanvases.forEach((canvas, index) => {
    const x = (index % columns) * PANEL_WIDTH;
    const y = Math.floor(index / columns) * PANEL_HEIGHT;
    context.drawImage(canvas, x, y, PANEL_WIDTH, PANEL_HEIGHT);
  });

  const link = document.createElement("a");
  link.download = `comic-chat-strip-${Date.now()}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
}

async function initialLoad(): Promise<void> {
  try {
    const [backgroundBuffer, firstPanel] = await Promise.all([
      fetchAsset(backdropSelect.value),
      createConversationPanel("connor.avb", "The web? Sure. But make it a comic."),
    ]);
    const background = parseAvatar(backgroundBuffer);
    if (!background.backdrop) throw new Error("The selected backdrop is incomplete");
    backdropBitmap = await decodeImage(backgroundBuffer, background.backdrop, background.palette);
    conversation.push(firstPanel);
    characterSelect.selectedIndex = 1;
    renderStrip();
    setStatus("Conversation ready. Add the next line.");
  } catch (error) {
    showError(error);
  }
}

messageInput.addEventListener("input", updateControls);
messageInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void addPanel().catch(showError);
});
backdropSelect.addEventListener("change", () => loadBackdrop().catch(showError));
addButton.addEventListener("click", () => addPanel().catch(showError));
undoButton.addEventListener("click", () => {
  const removed = conversation.pop();
  renderStrip();
  setStatus(removed ? `Removed ${removed.characterName}'s last panel.` : "The strip is already empty.");
});
clearButton.addEventListener("click", () => {
  conversation.length = 0;
  renderStrip();
  setStatus("Strip cleared. Write a line to begin again.");
});
downloadButton.addEventListener("click", downloadStrip);

updateControls();
void initialLoad();
