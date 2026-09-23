import "./styles.css";
import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "./avb";
import { analyzeMessage, selectPose, type EmotionResult } from "./emotion";
import { IrcWebClient, type LiveEvent, type LiveMessageEvent, type LiveRoomEvent, type LiveState } from "./irc-client";
import { PANEL_HEIGHT, PANEL_WIDTH, PanelRenderer } from "./panel";
import { createRoomUrl, normalizeRoomSelection, roomSelectionFromUrl } from "./room-link";

const characters = [
  { file: "anna.avb", label: "Anna" },
  { file: "armando.avb", label: "Armando" },
  { file: "bolo.avb", label: "Bolo" },
  { file: "buck.avb", label: "Buck" },
  { file: "connor.avb", label: "Connor" },
  { file: "cro.avb", label: "Cro" },
  { file: "dan.avb", label: "Dan" },
  { file: "denise.avb", label: "Denise" },
  { file: "glenda.avb", label: "Glenda" },
  { file: "hugh.avb", label: "Hugh" },
  { file: "jordan.avb", label: "Jordan" },
  { file: "kirby.avb", label: "Kirby" },
  { file: "lance.avb", label: "Lance" },
  { file: "lynnea.avb", label: "Lynnea" },
  { file: "margaret.avb", label: "Margaret" },
  { file: "mike.avb", label: "Mike" },
  { file: "pedagog.avb", label: "Pedagog" },
  { file: "rainbow.avb", label: "Rainbow" },
  { file: "susan.avb", label: "Susan" },
  { file: "tiki.avb", label: "Tiki" },
  { file: "tongtyed.avb", label: "Tongue-Tied" },
  { file: "tux.avb", label: "Tux" },
  { file: "veronica.avb", label: "Veronica" },
  { file: "waf.avb", label: "Waf" },
  { file: "xeno.avb", label: "Xeno" },
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
  <div class="classic-window">
    <header class="classic-titlebar">
      <span class="classic-app-icon" aria-hidden="true"></span>
      <strong>Microsoft Comic Chat - [<span id="window-room">Not connected</span>]</strong>
      <span class="window-buttons" aria-hidden="true"><i>_</i><i>□</i><i>×</i></span>
    </header>
    <nav class="classic-menu" aria-label="Application menu">
      <span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span>F<u>o</u>rmat</span><span><u>R</u>oom</span><span><u>M</u>ember</span><span>F<u>a</u>vorites</span><span><u>H</u>elp</span>
    </nav>
    <div class="classic-toolbar" aria-label="Classic Comic Chat toolbar">
      <div class="toolbar-sprite" aria-hidden="true"></div>
      <span class="toolbar-separator"></span>
      <button class="toolbar-text" type="button" title="Comic view">A</button>
      <button class="toolbar-text" type="button" title="Bold"><strong>B</strong></button>
      <button class="toolbar-text" type="button" title="Italic"><em>I</em></button>
      <button class="toolbar-text" type="button" title="Underline"><u>U</u></button>
    </div>

    <main class="classic-main">
      <section id="live-console" class="live-console" data-state="offline" aria-label="IRC connection">
        <div class="live-heading">
          <span id="live-dot" class="live-dot"></span>
          <span><small>Connection</small><strong id="live-status">Not connected</strong></span>
        </div>
        <label>Server<select id="network"><option value="libera">Libera.Chat</option><option value="oftc">OFTC</option></select></label>
        <label>Nickname<input id="nickname" maxlength="16" autocomplete="nickname" /></label>
        <label>Room (optional)<input id="channel" maxlength="52" placeholder="Browse all rooms" spellcheck="false" /></label>
        <div class="live-actions">
          <button id="connect-live" class="connect-button" type="button">Browse rooms</button>
          <button id="share-room" class="share-room-button" type="button" disabled>Copy room link</button>
        </div>
      </section>

      <section id="room-browser" class="room-browser" hidden aria-label="Public room directory">
        <header><strong>Room List</strong><span id="room-summary">Connecting to server…</span></header>
        <div class="room-tools">
          <label for="room-filter">Find:</label><input id="room-filter" type="search" placeholder="Search room names and topics" />
          <button id="refresh-rooms" type="button">Refresh List</button>
        </div>
        <div class="room-columns"><span>Room</span><span>Members</span><span>Topic</span></div>
        <div id="room-list" class="room-list" role="list"></div>
        <p>Double-click a room—or use Join—to enter it. You can still type a known room above.</p>
      </section>

      <div class="room-tab"><span aria-hidden="true">▰</span><strong id="room-tab-label">Offline comic</strong></div>
      <section class="workspace" aria-label="Comic conversation editor">
        <div class="stage-wrap conversation-stage">
          <div class="strip-heading"><span>Comic view</span><strong id="strip-count">0 panels</strong></div>
          <div id="strip" class="comic-strip" aria-live="polite"></div>
        </div>

        <aside class="controls">
          <section class="member-pane">
            <header>Members</header>
            <div id="member-list" class="member-list"><p>Connect to see room members.</p></div>
          </section>
          <section class="character-pane">
            <header>Your character</header>
            <canvas id="character-preview" class="character-figure" width="200" height="108" aria-label="Selected Comic Chat character"></canvas>
            <label for="character">Character</label>
            <select id="character">${characters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>
            <label for="backdrop">Background</label>
            <select id="backdrop">${backdrops.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>
            <div class="emotion-wheel" aria-label="Automatic expression preview">
              <i>☺</i><i>☹</i><i>!</i><i>☻</i><strong id="tone-value">Neutral</strong><i>?</i><i>♥</i><i>…</i><i>☺</i>
            </div>
            <small id="tone-reason">No expression cues</small>
          </section>
        </aside>
      </section>

      <section class="composer">
        <label for="message">Message:</label>
        <textarea id="message" maxlength="180" rows="2" placeholder="Type a message…"></textarea>
        <span class="count"><span id="count">0</span> / 180</span>
        <button id="add-panel" class="add-button" type="button" disabled><span id="add-label">Add to comic</span><span>➤</span></button>
        <div class="strip-actions">
          <button id="undo-panel" class="small-action" type="button">Undo</button>
          <button id="clear-strip" class="small-action" type="button">Clear</button>
          <button id="download" class="download-button" type="button" disabled>Save Comic</button>
        </div>
      </section>
      <footer class="classic-statusbar">
        <p id="status" class="status" role="status">Loading original art…</p>
        <span>Original Comic Chat 2.5 art and expression rules</span>
      </footer>
    </main>
  </div>
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
const roomBrowser = element<HTMLElement>("#room-browser");
const roomList = element<HTMLElement>("#room-list");
const roomFilter = element<HTMLInputElement>("#room-filter");
const roomSummary = element<HTMLElement>("#room-summary");
const refreshRoomsButton = element<HTMLButtonElement>("#refresh-rooms");
const memberList = element<HTMLElement>("#member-list");
const roomTabLabel = element<HTMLElement>("#room-tab-label");
const windowRoom = element<HTMLElement>("#window-room");
const characterPreview = element<HTMLCanvasElement>("#character-preview");

const avatarCache = new Map<string, Promise<LoadedAvatar>>();
const poseCache = new Map<string, Promise<DecodedBitmap>>();
const conversation: ConversationPanel[] = [];
let panelCanvases: HTMLCanvasElement[] = [];
let backdropBitmap: DecodedBitmap;
let backdropGeneration = 0;
let isAdding = false;
let liveState: LiveState = "offline";
let remoteQueue = Promise.resolve();
const publicRooms = new Map<string, LiveRoomEvent>();
const knownMembers = new Set<string>();
let totalPublicRooms = 0;

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
  knownMembers.add(event.nickname);
  renderMembers();
  const message = normalizeIrcText(event.message);
  if (!message) return;
  const characterFile = characterForNickname(event.nickname);
  const panel = await createConversationPanel(characterFile, message, event.nickname);
  appendConversationPanel(panel, true);
  setStatus(`${event.nickname}: ${panel.emotion.label.toLowerCase()} · live IRC`);
}

function renderMembers(): void {
  memberList.replaceChildren();
  if (knownMembers.size === 0) {
    const empty = document.createElement("p");
    empty.textContent = liveState === "joined" ? "Waiting for room activity…" : "Connect to see room members.";
    memberList.append(empty);
    return;
  }
  for (const nickname of [...knownMembers].sort((left, right) => left.localeCompare(right))) {
    const row = document.createElement("div");
    row.className = "member-row";
    const icon = document.createElement("span");
    icon.textContent = "♟";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("strong");
    label.textContent = nickname;
    row.append(icon, label);
    memberList.append(row);
  }
}

function joinRoom(channel: string): void {
  const room = normalizeRoomSelection(networkSelect.value, channel);
  if (!room) throw new Error("That room name is not IRC-safe");
  channelInput.value = room.channel;
  liveClient.join(room.channel);
  roomBrowser.hidden = true;
  updateControls();
}

function renderRoomList(): void {
  const filter = roomFilter.value.trim().toLocaleLowerCase();
  const matching = [...publicRooms.values()]
    .filter((room) => !filter || `${room.channel} ${room.topic}`.toLocaleLowerCase().includes(filter))
    .sort((left, right) => right.users - left.users || left.channel.localeCompare(right.channel))
    .slice(0, 200);
  roomList.replaceChildren();

  if (matching.length === 0) {
    const empty = document.createElement("p");
    empty.className = "room-empty";
    empty.textContent = publicRooms.size === 0 ? "Waiting for the server's public room list…" : "No rooms match that search.";
    roomList.append(empty);
  }

  for (const room of matching) {
    const row = document.createElement("article");
    row.className = "room-row";
    row.setAttribute("role", "listitem");
    const name = document.createElement("strong");
    name.textContent = room.channel;
    const users = document.createElement("span");
    users.textContent = String(room.users);
    const topic = document.createElement("span");
    topic.textContent = room.topic || "No topic";
    const join = document.createElement("button");
    join.type = "button";
    join.textContent = "Join";
    join.addEventListener("click", () => {
      try {
        joinRoom(room.channel);
      } catch (error) {
        showError(error);
      }
    });
    row.addEventListener("dblclick", () => join.click());
    row.append(name, users, topic, join);
    roomList.append(row);
  }
  roomSummary.textContent = `${matching.length} shown · ${totalPublicRooms || publicRooms.size} public rooms found`;
}

function updateLiveUi(state: LiveState, message: string): void {
  liveState = state;
  liveConsole.dataset.state = state;
  liveStatus.textContent = message;
  const active = state === "connecting" || state === "browsing" || state === "joining" || state === "joined";
  networkSelect.disabled = active;
  nicknameInput.disabled = active;
  channelInput.disabled = active;
  connectButton.textContent = active ? "Disconnect" : channelInput.value.trim() ? "Connect & join" : "Browse rooms";
  addLabel.textContent = state === "joined" ? "Send to room" : "Add to comic";
  roomBrowser.hidden = state !== "browsing";
  refreshRoomsButton.disabled = state !== "browsing";
  if (state !== "joined") {
    roomTabLabel.textContent = state === "browsing" ? "Room list" : "Offline comic";
    windowRoom.textContent = state === "browsing" ? "Room List" : "Not connected";
  }
  updateControls();
}

function handleLiveEvent(event: LiveEvent): void {
  if (event.type === "status") {
    updateLiveUi(event.state, event.message);
    if (event.state === "browsing") renderRoomList();
    if (event.state === "joined") {
      const channel = event.channel ?? channelInput.value;
      roomTabLabel.textContent = channel;
      windowRoom.textContent = channel;
      knownMembers.clear();
      if (event.nickname) knownMembers.add(event.nickname);
      renderMembers();
      setStatus(`${event.message}. New channel messages will become panels.`);
    }
    return;
  }
  if (event.type === "room") {
    publicRooms.set(event.channel, event);
    if (publicRooms.size % 20 === 0) renderRoomList();
    return;
  }
  if (event.type === "rooms") {
    if (event.reset) {
      publicRooms.clear();
      totalPublicRooms = 0;
    } else {
      totalPublicRooms = event.total ?? event.count;
    }
    roomSummary.textContent = event.reset ? "Loading rooms…" : `${event.count} popular rooms shown`;
    renderRoomList();
    return;
  }
  if (event.type === "members") {
    knownMembers.clear();
    for (const nickname of event.members) knownMembers.add(nickname);
    renderMembers();
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
  if (!liveClient.active) connectButton.textContent = channelInput.value.trim() ? "Connect & join" : "Browse rooms";
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

async function updateCharacterPreview(): Promise<void> {
  const avatar = await loadAvatar(characterSelect.value);
  const emotion = analyzeMessage(messageInput.value);
  const poseIndex = selectPose(avatar.metadata.bodies, emotion);
  const bitmap = await loadPose(characterSelect.value, avatar, poseIndex);
  const context = characterPreview.getContext("2d");
  if (!context) return;
  const source = document.createElement("canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const previewPixels = new Uint8ClampedArray(bitmap.pixels);
  source.getContext("2d")?.putImageData(new ImageData(previewPixels, bitmap.width, bitmap.height), 0, 0);
  context.clearRect(0, 0, characterPreview.width, characterPreview.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, characterPreview.width, characterPreview.height);
  const scale = Math.min((characterPreview.width - 12) / bitmap.width, (characterPreview.height - 8) / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, (characterPreview.width - width) / 2, characterPreview.height - height - 3, width, height);
}

function advanceSpeaker(): void {
  characterSelect.selectedIndex = (characterSelect.selectedIndex + 1) % characterSelect.options.length;
  void updateCharacterPreview().catch(showError);
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
    characterSelect.value = "glenda.avb";
    await updateCharacterPreview();
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
characterSelect.addEventListener("change", () => updateCharacterPreview().catch(showError));
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
  const requestedChannel = channelInput.value.trim();
  const room = normalizeRoomSelection(networkSelect.value, channelInput.value);
  const nicknameIsValid = /^[A-Za-z][A-Za-z0-9_\-[\]\\`^{}]{0,15}$/.test(nickname);
  const channelIsValid = requestedChannel.length === 0 || room !== undefined;
  if (!nicknameIsValid || !channelIsValid) {
    liveConsole.dataset.state = "error";
    liveStatus.textContent = nicknameIsValid
      ? "Enter a valid #channel"
      : "Nickname must start with a letter and use IRC-safe characters";
    return;
  }
  if (room) channelInput.value = room.channel;
  publicRooms.clear();
  knownMembers.clear();
  renderMembers();
  try {
    liveClient.connect({
      network: room?.network ?? (networkSelect.value === "oftc" ? "oftc" : "libera"),
      nickname,
      ...(room ? { channel: room.channel } : {}),
    });
  } catch (error) {
    showError(error);
  }
});
shareRoomButton.addEventListener("click", () => copyRoomLink().catch(showError));
networkSelect.addEventListener("change", updateControls);
channelInput.addEventListener("input", updateControls);
roomFilter.addEventListener("input", renderRoomList);
refreshRoomsButton.addEventListener("click", () => {
  try {
    liveClient.listRooms();
  } catch (error) {
    showError(error);
  }
});

nicknameInput.value = `Comic${Math.floor(1000 + Math.random() * 9000)}`;
const linkedRoom = roomSelectionFromUrl(new URL(window.location.href));
if (linkedRoom) {
  networkSelect.value = linkedRoom.network;
  channelInput.value = linkedRoom.channel;
  liveStatus.textContent = `Room ready: ${linkedRoom.channel}`;
}
updateControls();
void initialLoad();
void updateCharacterPreview();
