import "@fontsource/comic-neue/400.css";
import "@fontsource/comic-neue/400-italic.css";
import comicNeueLicenseUrl from "@fontsource/comic-neue/LICENSE?url";
import "./styles.css";
import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "./avb";
import { bodyForText, composeChoice, type ComposedBody } from "./composite";
import { createEmotionWheel, posesForWheel, type WheelEmotion } from "./emotion-wheel";
import { describeOptions, emotionOptions, newPoseMemory, type PoseChoice, type PoseMemory } from "./expression";
import { IrcWebClient, type LiveEvent, type LiveMessageEvent, type LiveRoomEvent, type LiveState } from "./irc-client";
import { balloonFontMetrics, type BalloonMode } from "./layout/balloon";
import { ComicPage, type ComicLine } from "./layout/page";
import { canvasMeasurer, drawPanel, drawTitlePanel } from "./layout/render";
import { layoutTitlePanel } from "./layout/title";
import { createRoomUrl, normalizeRoomSelection, roomSelectionFromUrl } from "./room-link";

interface ArtChoice { file: string; label: string }

const artPackAssets = import.meta.glob("../../v2.5-beta-1-modern/artpack1/*.{avb,bgb}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const artPack = (file: string): string => {
  const asset = artPackAssets[`../../v2.5-beta-1-modern/artpack1/${file}`];
  if (!asset) throw new Error(`Missing original Art Pack asset: ${file}`);
  return asset;
};

const characters: ArtChoice[] = [
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
  { file: artPack("kevin.avb"), label: "Kevin — Art Pack" },
  { file: artPack("kwensa.avb"), label: "Kwensa — Art Pack" },
  { file: artPack("maynard.avb"), label: "Maynard — Art Pack" },
  { file: artPack("rebecca.avb"), label: "Rebecca — Art Pack" },
  { file: artPack("sage.avb"), label: "Sage — Art Pack" },
  { file: artPack("scotty.avb"), label: "Scotty — Art Pack" },
  { file: artPack("bolo.avb"), label: "Bolo — Art Pack edition" },
  { file: artPack("cro.avb"), label: "Cro — Art Pack edition" },
  { file: artPack("denise.avb"), label: "Denise — Art Pack edition" },
  { file: artPack("lynnea.avb"), label: "Lynnea — Art Pack edition" },
];

const backdrops: ArtChoice[] = [
  { file: "room.bgb", label: "The room" },
  { file: "space.bgb", label: "Deep space" },
  { file: "clouds.bgb", label: "Clouds" },
  { file: "field.bgb", label: "The field" },
  { file: "pastoral.bgb", label: "Pastoral" },
  { file: "yellow.bgb", label: "Yellow" },
  { file: "buckroom.bgb", label: "Buck's room" },
  { file: artPack("den.bgb"), label: "The den — Art Pack" },
  { file: artPack("volcano.bgb"), label: "Volcano — Art Pack" },
];

const PANEL_TWIPS = 4860;
const PANEL_SCALE = 1 / 15;
const PANEL_PIXELS = PANEL_TWIPS * PANEL_SCALE;
const MAX_LIVE_LINES = 48;

interface LoadedAvatar {
  buffer: ArrayBuffer;
  metadata: AvatarFile;
  memory: PoseMemory;
  poses: Map<string, HTMLCanvasElement>;
  icon?: HTMLCanvasElement;
}

interface ConversationLine {
  characterFile: string;
  characterName: string;
  message: string;
  mode: BalloonMode;
  body: ComposedBody;
  poseRef: string;
  expression: string;
  talkTo: string[];
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
          <div class="strip-heading">
            <span>Comic view</span>
            <label class="panel-size" for="panel-size">Panel size
              <input id="panel-size" type="range" min="60" max="160" step="10" value="100" />
              <output id="panel-size-value" for="panel-size">100%</output>
            </label>
            <strong id="strip-count">0 panels</strong>
          </div>
          <div id="strip" class="comic-strip" aria-live="polite"></div>
        </div>

        <aside class="controls">
          <section class="member-pane">
            <header><span>Members</span><small id="member-target-summary">Select who you are talking to</small></header>
            <div id="member-list" class="member-list"><p>Connect to see room members.</p></div>
          </section>
          <section class="character-pane">
            <header>Your character</header>
            <canvas id="character-preview" class="character-figure" width="200" height="108" aria-label="Selected Comic Chat character"></canvas>
            <label for="character">Character</label>
            <select id="character">${characters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>
            <label for="backdrop">Background</label>
            <select id="backdrop">${backdrops.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>
            <div id="emotion-wheel" class="emotion-wheel" aria-label="Emotion wheel"></div>
            <strong id="tone-value" class="tone-value">Neutral</strong>
            <small id="tone-reason">No expression cues</small>
          </section>
        </aside>
      </section>

      <section class="composer">
        <label for="message">Message:</label>
        <textarea id="message" maxlength="180" rows="2" placeholder="Type a message…"></textarea>
        <span class="count"><span id="count">0</span> / 180</span>
        <button id="add-panel" class="add-button" type="button" disabled><span id="add-label">Add to comic</span><span>➤</span></button>
        <div class="mode-picker" role="group" aria-label="Balloon style">
          <span>Balloon:</span>
          <select id="message-mode" class="visually-hidden" aria-label="Balloon style"><option value="say">Say</option><option value="think">Think</option><option value="whisper">Whisper</option><option value="action">Action</option></select>
          <button class="mode-button selected" type="button" data-mode="say" title="Say" aria-pressed="true"><i></i></button>
          <button class="mode-button" type="button" data-mode="think" title="Think" aria-pressed="false"><i></i></button>
          <button class="mode-button" type="button" data-mode="whisper" title="Whisper" aria-pressed="false"><i></i></button>
          <button class="mode-button" type="button" data-mode="action" title="Action" aria-pressed="false"><i></i></button>
        </div>
        <div class="strip-actions">
          <button id="undo-panel" class="small-action" type="button">Undo</button>
          <button id="clear-strip" class="small-action" type="button">Clear</button>
          <button id="download" class="download-button" type="button" disabled>Save Comic</button>
        </div>
      </section>
      <footer class="classic-statusbar">
        <p id="status" class="status" role="status">Loading original art…</p>
        <span>Original Comic Chat 2.5 art and expression rules · <a href="${comicNeueLicenseUrl}" target="_blank" rel="noreferrer">font notice</a></span>
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
const messageMode = element<HTMLSelectElement>("#message-mode");
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>(".mode-button")];
const countLabel = element<HTMLElement>("#count");
const toneValue = element<HTMLElement>("#tone-value");
const toneReason = element<HTMLElement>("#tone-reason");
const strip = element<HTMLElement>("#strip");
const stripCount = element<HTMLElement>("#strip-count");
const panelSizeInput = element<HTMLInputElement>("#panel-size");
const panelSizeValue = element<HTMLOutputElement>("#panel-size-value");
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
const memberTargetSummary = element<HTMLElement>("#member-target-summary");
const roomTabLabel = element<HTMLElement>("#room-tab-label");
const windowRoom = element<HTMLElement>("#window-room");
const characterPreview = element<HTMLCanvasElement>("#character-preview");
const emotionWheelHost = element<HTMLElement>("#emotion-wheel");

const avatarCache = new Map<string, Promise<LoadedAvatar>>();
const conversation: ConversationLine[] = [];
const frozenPoses = new Map<string, PoseChoice>();
let panelCanvases: HTMLCanvasElement[] = [];
let backdropBitmap: DecodedBitmap;
let backdropCanvas: HTMLCanvasElement;
let backdropGeneration = 0;
let renderGeneration = 0;
let memberGeneration = 0;
let previewGeneration = 0;
let isAdding = false;
let liveState: LiveState = "offline";
let remoteQueue = Promise.resolve();
const publicRooms = new Map<string, LiveRoomEvent>();
const knownMembers = new Set<string>();
const selectedAddressees = new Set<string>();
let totalPublicRooms = 0;
let currentWheelEmotion: WheelEmotion = { emotion: 0, intensity: 0 };
let suppressWheelChange = false;

const emotionWheel = createEmotionWheel({
  size: 132,
  onChange: (emotion, name) => {
    currentWheelEmotion = emotion;
    if (suppressWheelChange) return;
    void loadAvatar(characterSelect.value).then(async (avatar) => {
      const choice = posesForWheel(avatar.metadata, emotion, avatar.memory);
      frozenPoses.set(characterSelect.value, choice);
      toneValue.textContent = name;
      toneReason.textContent = "Wheel pose will be used for the next line";
      await updateCharacterPreview();
    }).catch(showError);
  },
});
emotionWheelHost.append(emotionWheel.element);

function resetEmotionWheel(): void {
  currentWheelEmotion = { emotion: 0, intensity: 0 };
  suppressWheelChange = true;
  emotionWheel.set(currentWheelEmotion);
  suppressWheelChange = false;
}

async function fetchAsset(file: string): Promise<ArrayBuffer> {
  const response = await fetch(file.startsWith("/") ? file : `/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.arrayBuffer();
}

function bitmapCanvas(bitmap: DecodedBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.putImageData(
    new ImageData(new Uint8ClampedArray(bitmap.pixels), bitmap.width, bitmap.height),
    0,
    0,
  );
  return canvas;
}

function loadAvatar(file: string): Promise<LoadedAvatar> {
  const cached = avatarCache.get(file);
  if (cached) return cached;
  const pending = fetchAsset(file).then((buffer) => {
    const metadata = parseAvatar(buffer);
    const hasSimpleBody = metadata.type === AvatarType.Simple && metadata.bodies.length > 0;
    const hasCompositeBody = metadata.faces.length > 0 && metadata.torsos.length > 0;
    if (!hasSimpleBody && !hasCompositeBody) {
      throw new Error(`${file} does not contain a supported Comic Chat character`);
    }
    return { buffer, metadata, memory: newPoseMemory(), poses: new Map() };
  });
  avatarCache.set(file, pending);
  return pending;
}

function cacheBody(avatar: LoadedAvatar, body: ComposedBody): HTMLCanvasElement {
  let canvas = avatar.poses.get(body.key);
  if (!canvas) {
    canvas = bitmapCanvas(body.bitmap);
    avatar.poses.set(body.key, canvas);
  }
  return canvas;
}

async function avatarIcon(avatar: LoadedAvatar): Promise<HTMLCanvasElement | undefined> {
  if (avatar.icon) return avatar.icon;
  if (!avatar.metadata.icon?.offset) return undefined;
  avatar.icon = bitmapCanvas(await decodeImage(avatar.buffer, avatar.metadata.icon, avatar.metadata.palette));
  return avatar.icon;
}

function addressedPeople(message: string, speaker: string, selected: readonly string[] = []): string[] {
  const explicit = selected.filter((name) => name.toLocaleLowerCase() !== speaker.toLocaleLowerCase());
  if (explicit.length > 0) return explicit;
  const prefix = message.match(/^([^:]{1,32}):\s/iu)?.[1]?.toLocaleLowerCase();
  if (!prefix) return [];
  const candidates = new Set([...conversation.map((line) => line.characterName), ...knownMembers]);
  return [...candidates].filter((name) => name !== speaker && name.toLocaleLowerCase() === prefix);
}

function displayCharacterName(avatar: AvatarFile, file: string): string {
  const name = avatar.name || characters.find((choice) => choice.file === file)?.label.split(" —")[0] || "Character";
  return name.toLocaleLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

async function createConversationLine(
  characterFile: string,
  message: string,
  displayName?: string,
  mode: BalloonMode = "say",
  selected: readonly string[] = [],
): Promise<ConversationLine> {
  const avatar = await loadAvatar(characterFile);
  const frozen = frozenPoses.get(characterFile);
  if (frozen) frozenPoses.delete(characterFile);
  const body = frozen
    ? await composeChoice(avatar.buffer, avatar.metadata, frozen)
    : await bodyForText(avatar.buffer, avatar.metadata, message, avatar.memory);
  cacheBody(avatar, body);
  const options = emotionOptions(message);
  const characterName = displayName || displayCharacterName(avatar.metadata, characterFile);
  return {
    characterFile,
    characterName,
    message,
    mode,
    body,
    poseRef: `${characterFile}|${body.key}`,
    expression: frozen ? "wheel selection" : describeOptions(options),
    talkTo: addressedPeople(message, characterName, selected),
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
  if (nicknameInput.value && nickname.toLocaleLowerCase() === nicknameInput.value.toLocaleLowerCase()) {
    return characterSelect.value;
  }
  let hash = 2166136261;
  for (const character of nickname.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return characters[Math.abs(hash) % characters.length].file;
}

function normalizeIrcText(message: string): { text: string; mode: BalloonMode } {
  const action = message.match(/^\u0001ACTION (.*)\u0001$/);
  const visible = action ? action[1] : message;
  const clean = visible.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return {
    text: clean.length <= 180 ? clean : `${clean.slice(0, 177)}…`,
    mode: action ? "action" : "say",
  };
}

function appendConversationLine(line: ConversationLine, rolling = false): void {
  if (rolling && conversation.length >= MAX_LIVE_LINES) {
    conversation.shift();
  }
  conversation.push(line);
  void renderStrip().catch(showError);
}

async function addRemoteMessage(event: LiveMessageEvent): Promise<void> {
  if (event.self) return;
  knownMembers.add(event.nickname);
  renderMembers();
  const { text, mode } = normalizeIrcText(event.message);
  if (!text) return;
  const characterFile = characterForNickname(event.nickname);
  const line = await createConversationLine(characterFile, text, event.nickname, mode);
  appendConversationLine(line, true);
  setStatus(`${event.nickname}: ${line.expression} · live IRC`);
}

function renderMembers(): void {
  const generation = ++memberGeneration;
  memberList.dataset.generation = String(generation);
  memberList.replaceChildren();
  if (knownMembers.size === 0) {
    selectedAddressees.clear();
    memberTargetSummary.textContent = "Select who you are talking to";
    const empty = document.createElement("p");
    empty.textContent = liveState === "joined" ? "Waiting for room activity…" : "Connect to see room members.";
    memberList.append(empty);
    return;
  }
  for (const nickname of selectedAddressees) {
    if (![...knownMembers].some((member) => member.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      selectedAddressees.delete(nickname);
    }
  }
  const updateTargetSummary = (): void => {
    const names = [...selectedAddressees];
    memberTargetSummary.textContent = names.length === 0
      ? "Select who you are talking to"
      : `Talking to: ${names.join(", ")}`;
  };
  updateTargetSummary();
  for (const nickname of [...knownMembers].sort((left, right) => left.localeCompare(right))) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "member-row";
    const isSelf = nickname.toLocaleLowerCase() === nicknameInput.value.trim().toLocaleLowerCase();
    row.disabled = isSelf;
    row.classList.toggle("selected", selectedAddressees.has(nickname));
    row.setAttribute("aria-pressed", String(selectedAddressees.has(nickname)));
    row.title = isSelf ? "This is you" : "Address your next lines to this member";
    const icon = document.createElement("canvas");
    icon.className = "member-icon";
    icon.width = 24;
    icon.height = 24;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("strong");
    label.textContent = isSelf ? `${nickname} (you)` : nickname;
    row.append(icon, label);
    row.addEventListener("click", (event) => {
      const extend = event.metaKey || event.ctrlKey;
      const wasSelected = selectedAddressees.has(nickname);
      if (extend) {
        if (wasSelected) selectedAddressees.delete(nickname);
        else selectedAddressees.add(nickname);
      } else if (wasSelected && selectedAddressees.size === 1) {
        selectedAddressees.clear();
      } else {
        selectedAddressees.clear();
        selectedAddressees.add(nickname);
      }
      renderMembers();
      messageInput.focus();
      const names = [...selectedAddressees];
      setStatus(names.length === 0
        ? "No addressee selected. The next line can establish a new shot."
        : `The next line will be addressed to ${names.join(", ")}.`);
    });
    memberList.append(row);
    void loadAvatar(characterForNickname(nickname)).then(avatarIcon).then((source) => {
      if (!source || memberList.dataset.generation !== String(generation)) return;
      const context = icon.getContext("2d");
      if (!context) return;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, icon.width, icon.height);
      const scale = Math.min(icon.width / source.width, icon.height / source.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(source, (icon.width - source.width * scale) / 2, (icon.height - source.height * scale) / 2, source.width * scale, source.height * scale);
    }).catch(() => {});
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
  const options = emotionOptions(messageInput.value);
  countLabel.textContent = String(messageInput.value.length);
  if (!frozenPoses.has(characterSelect.value)) {
    const expression = describeOptions(options);
    toneValue.textContent = expression === "neutral" ? "Neutral" : expression;
    toneReason.textContent = options.length === 0
      ? "No expression cues"
      : options.map((option) => option.source).join(" · ");
  }
  addButton.disabled = isAdding
    || messageInput.value.trim().length === 0;
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

function createPanelCanvas(label: string): { card: HTMLElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; ratio: number } {
  const card = document.createElement("article");
  card.className = "panel-card authentic-panel";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", label);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(PANEL_PIXELS * ratio);
  canvas.height = Math.round(PANEL_PIXELS * ratio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.scale(ratio, ratio);
  const metadata = document.createElement("p");
  metadata.className = "panel-meta";
  card.append(canvas, metadata);
  return { card, canvas, context, ratio };
}

async function renderStrip(): Promise<void> {
  const generation = ++renderGeneration;
  const nextCanvases: HTMLCanvasElement[] = [];
  const fragment = document.createDocumentFragment();

  if (conversation.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-strip";
    empty.innerHTML = `<span>01</span><strong>Your next line starts the strip.</strong><p>Comic Chat will choose the pose and lay out the panel.</p>`;
    fragment.append(empty);
    if (generation !== renderGeneration) return;
    strip.replaceChildren(fragment);
    panelCanvases = [];
    stripCount.textContent = "0 panels";
    updateControls();
    return;
  }

  await document.fonts?.ready;
  const measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) throw new Error("Canvas is unavailable");
  const fonts = {
    normal: balloonFontMetrics(canvasMeasurer(measureContext)),
    whisper: balloonFontMetrics(canvasMeasurer(measureContext, { italic: true })),
  };
  const castFiles = new Map<string, string>();
  for (const line of conversation) castFiles.set(line.characterName, line.characterFile);
  const images = new Map<string, HTMLCanvasElement>();
  const icons = new Map<string, HTMLCanvasElement>();
  const neutral = new Map<string, { pose: { width: number; height: number; faceX: number }; poseRef: string }>();
  await Promise.all([...castFiles].map(async ([name, file]) => {
    const avatar = await loadAvatar(file);
    const body = await bodyForText(avatar.buffer, avatar.metadata, "", newPoseMemory());
    const image = cacheBody(avatar, body);
    const ref = `neutral|${name}|${file}|${body.key}`;
    images.set(ref, image);
    neutral.set(name, { pose: { width: image.width, height: image.height, faceX: body.faceX }, poseRef: ref });
    const icon = await avatarIcon(avatar);
    if (icon) icons.set(name, icon);
  }));
  for (const line of conversation) {
    const avatar = await loadAvatar(line.characterFile);
    const image = cacheBody(avatar, line.body);
    images.set(line.poseRef, image);
  }

  const currentTalkTo = new Map<string, string[]>();
  const page = new ComicPage({
    fonts,
    unitWidth: PANEL_TWIPS,
    unitHeight: PANEL_TWIPS,
    seed: 1,
    talkTos: (speaker) => currentTalkTo.get(speaker) ?? [],
    neutralPose: (speaker) => neutral.get(speaker),
  });
  const title = page.chooseTitle();
  for (const line of conversation) {
    currentTalkTo.set(line.characterName, line.talkTo);
    const image = images.get(line.poseRef)!;
    const comicLine: ComicLine = {
      speakerId: line.characterName,
      text: line.message,
      mode: line.mode,
      pose: { width: image.width, height: image.height, faceX: line.body.faceX },
      poseRef: line.poseRef,
    };
    page.addLine(comicLine);
  }

  const uniqueCast = [...castFiles].map(([id, file], index) => ({
    id,
    nickname: id,
    sends: conversation.filter((line) => line.characterName === id).length,
    self: index === 0,
    file,
  }));
  const titleLayout = layoutTitlePanel(title, uniqueCast, {
    measure: (text, height) => {
      measureContext.font = `${height}px "Comic Sans MS", "Comic Neue", cursive`;
      return measureContext.measureText(text).width;
    },
  });
  const titlePanel = createPanelCanvas(`Title: ${title}`);
  drawTitlePanel(titlePanel.context, titleLayout, (id) => icons.get(id), { scale: PANEL_SCALE });
  titlePanel.card.querySelector<HTMLElement>(".panel-meta")!.textContent = "Title and starring panel";
  fragment.append(titlePanel.card);
  nextCanvases.push(titlePanel.canvas);

  page.layouts.forEach((layout, index) => {
    const speakers = layout.bodies.filter((body) => !body.listener).map((body) => body.id);
    const panel = createPanelCanvas(`Panel ${index + 1}: ${speakers.join(", ")}`);
    drawPanel(panel.context, layout, {
      backdrop: backdropCanvas,
      body: (body) => images.get(String(body.poseRef)),
    }, { scale: PANEL_SCALE });
    panel.card.querySelector<HTMLElement>(".panel-meta")!.textContent =
      `Panel ${index + 1} · ${layout.balloons.length} ${layout.balloons.length === 1 ? "balloon" : "balloons"}`;
    fragment.append(panel.card);
    nextCanvases.push(panel.canvas);
  });

  if (generation !== renderGeneration) return;
  strip.replaceChildren(fragment);
  panelCanvases = nextCanvases;
  const count = page.layouts.length + 1;
  stripCount.textContent = `${count} ${count === 1 ? "panel" : "panels"} · ${conversation.length} ${conversation.length === 1 ? "line" : "lines"}`;
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
  backdropCanvas = bitmapCanvas(bitmap);
  await renderStrip();
  setStatus(`Scene changed · ${bitmap.width}×${bitmap.height}px original art`);
}

async function updateCharacterPreview(): Promise<void> {
  const generation = ++previewGeneration;
  const avatar = await loadAvatar(characterSelect.value);
  const frozen = frozenPoses.get(characterSelect.value);
  const body = frozen
    ? await composeChoice(avatar.buffer, avatar.metadata, frozen)
    : await bodyForText(avatar.buffer, avatar.metadata, messageInput.value, newPoseMemory());
  const bitmap = body.bitmap;
  if (generation !== previewGeneration) return;
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

async function addPanel(): Promise<void> {
  const message = messageInput.value.trim();
  if (!message || isAdding) return;
  isAdding = true;
  updateControls();
  setStatus("Reading the line and choosing a pose…");
  try {
    const mode = messageMode.value as BalloonMode;
    const line = await createConversationLine(characterSelect.value, message, undefined, mode, [...selectedAddressees]);
    if (liveState === "joined") liveClient.say(message, mode === "action");
    appendConversationLine(line, liveState === "joined");
    messageInput.value = "";
    setStatus(`${line.characterName}: ${line.expression} · ${line.mode} balloon${liveState === "joined" ? " · sent to IRC" : ""}`);
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
  output.width = PANEL_PIXELS * columns;
  output.height = PANEL_PIXELS * rows;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, output.width, output.height);
  panelCanvases.forEach((canvas, index) => {
    const x = (index % columns) * PANEL_PIXELS;
    const y = Math.floor(index / columns) * PANEL_PIXELS;
    context.drawImage(canvas, x, y, PANEL_PIXELS, PANEL_PIXELS);
  });

  const link = document.createElement("a");
  link.download = `comic-chat-strip-${Date.now()}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
}

async function initialLoad(): Promise<void> {
  try {
    const backgroundBuffer = await fetchAsset(backdropSelect.value);
    const background = parseAvatar(backgroundBuffer);
    if (!background.backdrop) throw new Error("The selected backdrop is incomplete");
    backdropBitmap = await decodeImage(backgroundBuffer, background.backdrop, background.palette);
    backdropCanvas = bitmapCanvas(backdropBitmap);
    characterSelect.value = "connor.avb";
    await updateCharacterPreview();
    await renderStrip();
    setStatus("Conversation ready. The original layout engine will compose the next line.");
  } catch (error) {
    showError(error);
  }
}

messageInput.addEventListener("input", () => {
  updateControls();
  if (!frozenPoses.has(characterSelect.value)) void updateCharacterPreview().catch(showError);
});
messageInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void addPanel().catch(showError);
});
backdropSelect.addEventListener("change", () => loadBackdrop().catch(showError));
characterSelect.addEventListener("change", () => {
  resetEmotionWheel();
  frozenPoses.delete(characterSelect.value);
  updateControls();
  void updateCharacterPreview().catch(showError);
});
messageMode.addEventListener("change", updateControls);
panelSizeInput.addEventListener("input", () => {
  const percent = Number(panelSizeInput.value);
  document.documentElement.style.setProperty("--panel-display-size", `${PANEL_PIXELS * percent / 100}px`);
  panelSizeValue.value = `${percent}%`;
  try {
    localStorage.setItem("comic-chat-panel-size", String(percent));
  } catch {}
});
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    messageMode.value = button.dataset.mode ?? "say";
    for (const candidate of modeButtons) {
      const selected = candidate === button;
      candidate.classList.toggle("selected", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    }
    updateControls();
    messageInput.focus();
  });
}
addButton.addEventListener("click", () => addPanel().catch(showError));
undoButton.addEventListener("click", () => {
  const removed = conversation.pop();
  void renderStrip().catch(showError);
  setStatus(removed ? `Removed ${removed.characterName}'s last line.` : "The strip is already empty.");
});
clearButton.addEventListener("click", () => {
  conversation.length = 0;
  void renderStrip().catch(showError);
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
try {
  const savedPanelSize = Number(localStorage.getItem("comic-chat-panel-size"));
  if (savedPanelSize >= 60 && savedPanelSize <= 160) panelSizeInput.value = String(savedPanelSize);
} catch {}
panelSizeInput.dispatchEvent(new Event("input"));
const linkedRoom = roomSelectionFromUrl(new URL(window.location.href));
if (linkedRoom) {
  networkSelect.value = linkedRoom.network;
  channelInput.value = linkedRoom.channel;
  liveStatus.textContent = `Room ready: ${linkedRoom.channel}`;
}
updateControls();
void initialLoad();
