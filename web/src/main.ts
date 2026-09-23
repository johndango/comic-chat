import "./styles.css";
import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "./avb";
import { analyzeMessage, selectPose, type EmotionResult } from "./emotion";
import { IrcWebClient, type LiveEvent, type LiveMessageEvent, type LiveState } from "./irc-client";
import { PANEL_HEIGHT, PANEL_WIDTH, PanelRenderer } from "./panel";
import { createRoomUrl, normalizeRoomSelection, roomSelectionFromUrl } from "./room-link";

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
      <span><strong>Comic Chat</strong><small>web lab / issue no. 004</small></span>
    </a>
    <span class="prototype-stamp">live IRC build</span>
  </header>
  <main>
    <section class="intro">
      <p class="eyebrow">A real IRC channel, rendered as a living comic strip</p>
      <h1>Join the chat.<br /><em>Watch it become a comic.</em></h1>
      <p class="lede">Compose offline or connect through the local TLS gateway. Every channel message becomes a panel using original artwork and expression rules.</p>
    </section>
    <section id="live-console" class="live-console" data-state="offline" aria-label="Live IRC connection">
      <div class="live-heading">
        <span id="live-dot" class="live-dot"></span>
        <span><small>live IRC</small><strong id="live-status">Offline composer</strong></span>
      </div>
      <label>Network<select id="network"><option value="libera">Libera.Chat</option><option value="oftc">OFTC</option></select></label>
      <label>Nickname<input id="nickname" maxlength="16" autocomplete="nickname" /></label>
      <label>Channel<input id="channel" maxlength="52" placeholder="#channel" spellcheck="false" /></label>
      <div class="live-actions">
        <button id="connect-live" class="connect-button" type="button">Connect securely</button>
        <button id="share-room" class="share-room-button" type="button" disabled>Copy room link</button>
      </div>
      <p>TLS only · room links contain the network and channel, never your nickname</p>
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

        <button id="add-panel" class="add-button" type="button" disabled><span id="add-label">Add panel to strip</span><span>＋</span></button>

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
    <span>Live transport · local WebSocket gateway · TLS IRC</span>
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
const liveConsole = element<HTMLElement>("#live-console");
const liveStatus = element<HTMLElement>("#live-status");
const networkSelect = element<HTMLSelectElement>("#network");
const nicknameInput = element<HTMLInputElement>("#nickname");
const channelInput = element<HTMLInputElement>("#channel");
const connectButton = element<HTMLButtonElement>("#connect-live");
const shareRoomButton = element<HTMLButtonElement>("#share-room");
const addLabel = element<HTMLElement>("#add-label");

const avatarCache = new Map<string, Promise<LoadedAvatar>>();
const poseCache = new Map<string, Promise<DecodedBitmap>>();
const conversation: ConversationPanel[] = [];
let panelCanvases: HTMLCanvasElement[] = [];
let backdropBitmap: DecodedBitmap;
let backdropGeneration = 0;
let isAdding = false;
let liveState: LiveState = "offline";
let remoteQueue = Promise.resolve();

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

async function createConversationPanel(
  characterFile: string,
  message: string,
  displayName?: string,
): Promise<ConversationPanel> {
  const avatar = await loadAvatar(characterFile);
  const emotion = analyzeMessage(message);
  const poseIndex = selectPose(avatar.metadata.bodies, emotion);
  const character = await loadPose(characterFile, avatar, poseIndex);
  return {
    characterFile,
    characterName: displayName || characters.find(({ file }) => file === characterFile)?.label || avatar.metadata.name || "Character",
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

function characterForNickname(nickname: string): string {
  let hash = 2166136261;
  for (const character of nickname.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return characters[Math.abs(hash) % characters.length].file;
}

function normalizeIrcText(message: string): string {
  const action = message.match(/^\u0001ACTION (.*)\u0001$/);
  const visible = action ? `* ${action[1]}` : message;
  const clean = visible.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return clean.length <= 180 ? clean : `${clean.slice(0, 177)}…`;
}

function appendConversationPanel(panel: ConversationPanel, rolling = false): void {
  if (conversation.length >= MAX_PANELS) {
    if (!rolling) throw new Error(`A strip can contain at most ${MAX_PANELS} panels`);
    conversation.shift();
  }
  conversation.push(panel);
  renderStrip();
}

async function addRemoteMessage(event: LiveMessageEvent): Promise<void> {
  if (event.self) return;
  const message = normalizeIrcText(event.message);
  if (!message) return;
  const characterFile = characterForNickname(event.nickname);
  const panel = await createConversationPanel(characterFile, message, event.nickname);
  appendConversationPanel(panel, true);
  setStatus(`${event.nickname}: ${panel.emotion.label.toLowerCase()} · live IRC`);
}

function updateLiveUi(state: LiveState, message: string): void {
  liveState = state;
  liveConsole.dataset.state = state;
  liveStatus.textContent = message;
  const active = state === "connecting" || state === "joining" || state === "joined";
  networkSelect.disabled = active;
  nicknameInput.disabled = active;
  channelInput.disabled = active;
  connectButton.textContent = active ? "Disconnect" : "Connect securely";
  addLabel.textContent = state === "joined" ? "Send to IRC + add panel" : "Add panel to strip";
  updateControls();
}

function handleLiveEvent(event: LiveEvent): void {
  if (event.type === "status") {
    updateLiveUi(event.state, event.message);
    if (event.state === "joined") setStatus(`${event.message}. New channel messages will become panels.`);
    return;
  }
  if (event.type === "error") {
    liveConsole.dataset.state = "error";
    liveStatus.textContent = event.message;
    showError(new Error(event.message));
    return;
  }
  remoteQueue = remoteQueue.then(() => addRemoteMessage(event)).catch(showError);
}

const liveClient = new IrcWebClient(handleLiveEvent);

function updateControls(): void {
  const emotion = analyzeMessage(messageInput.value);
  countLabel.textContent = String(messageInput.value.length);
  toneValue.textContent = emotion.label;
  toneReason.textContent = emotion.reason;
  addButton.disabled = isAdding
    || messageInput.value.trim().length === 0
    || (conversation.length >= MAX_PANELS && liveState !== "joined");
  undoButton.disabled = conversation.length === 0 || isAdding;
  clearButton.disabled = conversation.length === 0 || isAdding;
  downloadButton.disabled = conversation.length === 0 || isAdding;
  shareRoomButton.disabled = !normalizeRoomSelection(networkSelect.value, channelInput.value);
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
    return true;
  } catch {}

  const temporary = document.createElement("textarea");
  temporary.value = value;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  document.body.append(temporary);
  temporary.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    temporary.remove();
  }
}

async function copyRoomLink(): Promise<void> {
  const room = normalizeRoomSelection(networkSelect.value, channelInput.value);
  if (!room) throw new Error("Enter a valid channel before copying a room link");
  channelInput.value = room.channel;
  const url = createRoomUrl(new URL(window.location.href), room);
  window.history.replaceState(null, "", url);
  const copied = await copyText(url);
  setStatus(copied
    ? `Room link copied for ${room.channel}. It will not connect until opened and confirmed.`
    : `Room link ready for ${room.channel}. Copy it from the address bar.`);
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
  if (!message || (conversation.length >= MAX_PANELS && liveState !== "joined") || isAdding) return;
  isAdding = true;
  updateControls();
  setStatus("Reading the line and choosing a pose…");
  try {
    const panel = await createConversationPanel(characterSelect.value, message);
    if (liveState === "joined") liveClient.say(message);
    appendConversationPanel(panel, liveState === "joined");
    messageInput.value = "";
    if (liveState !== "joined") advanceSpeaker();
    setStatus(`${panel.characterName}: ${panel.emotion.label.toLowerCase()} · ${liveState === "joined" ? "sent to IRC" : `pose ${panel.poseIndex + 1}`}`);
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
connectButton.addEventListener("click", () => {
  if (liveClient.active) {
    liveClient.disconnect();
    return;
  }
  const nickname = nicknameInput.value.trim();
  const room = normalizeRoomSelection(networkSelect.value, channelInput.value);
  const channel = room?.channel ?? "";
  const nicknameIsValid = /^[A-Za-z][A-Za-z0-9_\-[\]\\`^{}]{0,15}$/.test(nickname);
  const channelIsValid = room !== undefined;
  if (!nicknameIsValid || !channelIsValid) {
    liveConsole.dataset.state = "error";
    liveStatus.textContent = nicknameIsValid
      ? "Enter a valid #channel"
      : "Nickname must start with a letter and use IRC-safe characters";
    return;
  }
  channelInput.value = channel;
  try {
    liveClient.connect({
      network: room!.network,
      nickname,
      channel,
    });
  } catch (error) {
    showError(error);
  }
});
shareRoomButton.addEventListener("click", () => copyRoomLink().catch(showError));
networkSelect.addEventListener("change", updateControls);
channelInput.addEventListener("input", updateControls);

nicknameInput.value = `Comic${Math.floor(1000 + Math.random() * 9000)}`;
const linkedRoom = roomSelectionFromUrl(new URL(window.location.href));
if (linkedRoom) {
  networkSelect.value = linkedRoom.network;
  channelInput.value = linkedRoom.channel;
  liveStatus.textContent = `Room ready: ${linkedRoom.channel}`;
}
updateControls();
void initialLoad();
