import "@fontsource/comic-neue/400.css";
import "@fontsource/comic-neue/400-italic.css";
import comicNeueLicenseUrl from "@fontsource/comic-neue/LICENSE?url";
import "./styles.css";
import { AvatarType, decodeImage, parseAvatar, type AvatarFile, type DecodedBitmap } from "./avb";
import {
  avatarRuleKey,
  parseAvatarAnnouncement,
  parseAvatarDisplayPolicy,
  preferAvatarEdition,
  resolveAvatarFile,
  type AvatarAnnouncement,
  type AvatarArtPreference,
  type AvatarDisplayPolicy,
  type AvatarEditionPair,
} from "./avatar-policy";
import { fetchAvatarFile, sameOriginAvatarUrl, validateAvatarImport } from "./avatar-import";
import {
  avatarDownloadName,
  BUILDER_EMOTIONS,
  buildSimpleAvatar,
  imageFileToRgba,
  type CreatorPose,
} from "./avatar-creator";
import { bodyForText, composeChoice, type ComposedBody } from "./composite";
import { createEmotionWheel, posesForWheel, type WheelEmotion } from "./emotion-wheel";
import { describeOptions, emotionOptions, newPoseMemory, type PoseChoice, type PoseMemory } from "./expression";
import { IrcWebClient, type LiveEvent, type LiveMessageEvent, type LiveRoomEvent, type LiveState } from "./irc-client";
import { balloonFontMetrics, type BalloonMode } from "./layout/balloon";
import { ComicPage, type ComicLine } from "./layout/page";
import { canvasMeasurer, drawPanel, drawTitlePanel } from "./layout/render";
import { layoutTitlePanel } from "./layout/title";
import { panelDisplaySize, parsePanelsAcross, parsePanelZoom, type PanelsAcross } from "./panel-view";
import { createRoomUrl, normalizeRoomSelection, roomSelectionFromUrl } from "./room-link";

interface ArtChoice { file: string; label: string; announcementName?: string }

const COLOR_REPLACEMENT_CREDIT_URL = "https://www.phoenix-online-nexus.com/Nexus_21/index.htm#instructionsavb";

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

const colorReplacementAssets = import.meta.glob("../../colorreplace21/*.AVB", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const colorReplacement = (file: string): string => {
  const asset = colorReplacementAssets[`../../colorreplace21/${file}`];
  if (!asset) throw new Error(`Missing color replacement asset: ${file}`);
  return asset;
};

const monochromeCharacters: ArtChoice[] = [
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
const colorReplacementDefinitions = [
  { name: "Anna", source: "ANNA_C.AVB", monochrome: "anna.avb" },
  { name: "Armando", source: "ARMANDO_C.AVB", monochrome: "armando.avb" },
  { name: "Bolo", source: "BOLO_C.AVB", monochrome: "bolo.avb" },
  { name: "Cro", source: "CRO_C.AVB", monochrome: "cro.avb" },
  { name: "Dan", source: "DAN_C.AVB", monochrome: "dan.avb" },
  { name: "Denise", source: "DENISE_C.AVB", monochrome: "denise.avb" },
  { name: "Hugh", source: "HUGH_C.AVB", monochrome: "hugh.avb" },
  { name: "Jordan", source: "JORDAN_C.AVB", monochrome: "jordan.avb" },
  { name: "Kevin", source: "KEVIN_C.AVB", monochrome: artPack("kevin.avb") },
  { name: "Lance", source: "LANCE_C.AVB", monochrome: "lance.avb" },
  { name: "Lynnea", source: "LYNNEA_C.AVB", monochrome: "lynnea.avb" },
  { name: "Margaret", source: "MARGARET_C.AVB", monochrome: "margaret.avb" },
  { name: "Maynard", source: "MAYNARD_C.AVB", monochrome: artPack("maynard.avb") },
  { name: "Mike", source: "MIKE_C.AVB", monochrome: "mike.avb" },
  { name: "Rebecca", source: "REBECCA_C.AVB", monochrome: artPack("rebecca.avb") },
  { name: "Sage", source: "SAGE_C.AVB", monochrome: artPack("sage.avb") },
  { name: "Scotty", source: "SCOTTY_C.AVB", monochrome: artPack("scotty.avb") },
  { name: "Susan", source: "SUSAN_C.AVB", monochrome: "susan.avb" },
  { name: "Tiki", source: "TIKI_C.AVB", monochrome: "tiki.avb" },
  { name: "Tongue-Tied", source: "TONGTYED_C.AVB", monochrome: "tongtyed.avb" },
  { name: "Xeno", source: "XENO_C.AVB", monochrome: "xeno.avb" },
] as const;
const colorCharacters: ArtChoice[] = colorReplacementDefinitions.map(({ name, source }) => ({
  file: colorReplacement(source),
  label: `${name} — Color edition`,
  announcementName: source.replace(/\.AVB$/u, ""),
}));
const characters: ArtChoice[] = [...monochromeCharacters, ...colorCharacters];
const characterOptionMarkup = `
  <optgroup label="Classic &amp; Art Pack">
    ${monochromeCharacters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}
  </optgroup>
  <optgroup label="Color replacements">
    ${colorCharacters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}
  </optgroup>`;
const avatarEditions = new Map<string, AvatarEditionPair>();
for (const definition of colorReplacementDefinitions) {
  const color = colorReplacement(definition.source);
  const pair = { monochrome: definition.monochrome, color };
  avatarEditions.set(pair.monochrome, pair);
  avatarEditions.set(pair.color, pair);
}
const officialCharacterFiles = new Set(characters.map(({ file }) => file));
const officialCharacterByName = new Map<string, string>();
for (const { file, label } of characters) {
  const name = label.split(" —")[0].toLocaleLowerCase();
  if (!officialCharacterByName.has(name)) officialCharacterByName.set(name, file);
}
for (const definition of colorReplacementDefinitions) {
  officialCharacterByName.set(definition.source.replace(/\.AVB$/u, "").toLocaleLowerCase(), colorReplacement(definition.source));
}

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
const MAX_SESSION_CUSTOM_AVATARS = 24;

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
            <div class="view-options">
              <label for="panels-across">Panels across
                <select id="panels-across">
                  <option value="auto">Auto</option>
                  ${[1, 2, 3, 4, 5, 6, 7].map((count) => `<option value="${count}">${count}</option>`).join("")}
                </select>
              </label>
              <label class="panel-size" for="panel-size">Zoom
                <input id="panel-size" type="range" min="60" max="160" step="10" value="100" />
                <output id="panel-size-value" for="panel-size">100%</output>
              </label>
            </div>
            <strong id="strip-count">0 panels</strong>
          </div>
          <div id="strip" class="comic-strip" aria-live="polite"></div>
        </div>

        <aside class="controls">
          <section class="member-pane">
            <header>
              <span>Members</span>
              <button id="avatar-rules-button" type="button">Avatars…</button>
              <small id="member-target-summary">Select who you are talking to</small>
            </header>
            <div id="member-list" class="member-list"><p>Connect to see room members.</p></div>
          </section>
          <section class="character-pane">
            <header>Your character</header>
            <canvas id="character-preview" class="character-figure" width="200" height="108" aria-label="Selected Comic Chat character"></canvas>
            <label for="character">Character</label>
            <select id="character">${characterOptionMarkup}</select>
            <div class="character-actions">
              <button id="import-avatar" type="button">Import .avb…</button>
              <button id="create-avatar" type="button">Create…</button>
              <input id="avatar-file" class="visually-hidden" type="file" accept=".avb,application/octet-stream" />
            </div>
            <small class="local-avatar-note">Imported characters stay in this browser tab until hosted.</small>
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
        <span>Original Comic Chat art and expression rules · <a href="${COLOR_REPLACEMENT_CREDIT_URL}" target="_blank" rel="noreferrer">color editions credit</a> · <a href="${comicNeueLicenseUrl}" target="_blank" rel="noreferrer">font notice</a></span>
      </footer>
    </main>
    <dialog id="avatar-rules-dialog" class="classic-dialog" aria-labelledby="avatar-rules-title">
      <form method="dialog">
        <header><strong id="avatar-rules-title">Avatar display rules</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body">
          <label class="official-only"><input id="official-avatars-only" type="checkbox" /> Show only official Comic Chat avatars</label>
          <p>Room-provided custom art is ignored when this is checked. When off, only validated avatars hosted on webcomicchat.com can load. A forced character always wins.</p>
          <fieldset class="avatar-art-preference">
            <legend>Preferred character art</legend>
            <label><input type="radio" name="avatar-art-preference" value="none" /> No preference</label>
            <label><input type="radio" name="avatar-art-preference" value="monochrome" /> Black &amp; white</label>
            <label><input type="radio" name="avatar-art-preference" value="color" /> Color</label>
          </fieldset>
          <p>Matching black-and-white and color editions swap automatically. Explicit member mappings below are left exactly as chosen. Color replacements from <a href="${COLOR_REPLACEMENT_CREDIT_URL}" target="_blank" rel="noreferrer">The Unofficial MS Chat Add-On Site</a>.</p>
          <div class="avatar-rule-columns"><strong>Room member</strong><strong>Display as</strong></div>
          <div id="avatar-rule-list" class="avatar-rule-list"></div>
        </div>
        <footer><button id="reset-avatar-rules" type="button">Reset mappings</button><button value="cancel">Close</button></footer>
      </form>
    </dialog>
    <dialog id="avatar-builder-dialog" class="classic-dialog avatar-builder-dialog" aria-labelledby="avatar-builder-title">
      <form method="dialog">
        <header><strong id="avatar-builder-title">Create a Comic Chat character</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body">
          <p>Build a simple character from transparent pose images. It stays local unless you choose to host the downloaded .avb later.</p>
          <div class="builder-fields">
            <label>Name <input id="builder-name" maxlength="60" placeholder="Character name" /></label>
            <label>Art credit <input id="builder-credit" maxlength="240" placeholder="Your name and license (optional)" /></label>
            <label>Style <select id="builder-style"><option value="mono">Classic black &amp; white</option><option value="color">Color</option></select></label>
            <label>Aura <span><input id="builder-aura" type="range" min="0" max="8" value="3" /><output id="builder-aura-value">3 px</output></span></label>
          </div>
          <div class="builder-add-row">
            <button id="builder-add-poses" type="button">Add pose images…</button>
            <input id="builder-files" class="visually-hidden" type="file" accept="image/png,image/webp,image/jpeg" multiple />
            <small>PNG with transparency works best · up to 16 images · 512×512 maximum</small>
          </div>
          <div id="builder-pose-list" class="builder-pose-list"></div>
          <p id="builder-status" class="builder-status" role="status">Add at least one neutral pose.</p>
        </div>
        <footer><button id="builder-clear" type="button">Clear poses</button><button value="cancel">Cancel</button><button id="builder-download" type="button" disabled>Build, use &amp; download</button></footer>
      </form>
    </dialog>
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
const panelsAcrossSelect = element<HTMLSelectElement>("#panels-across");
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
const avatarRulesButton = element<HTMLButtonElement>("#avatar-rules-button");
const avatarRulesDialog = element<HTMLDialogElement>("#avatar-rules-dialog");
const officialAvatarsOnly = element<HTMLInputElement>("#official-avatars-only");
const avatarArtPreferenceInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="avatar-art-preference"]')];
const avatarRuleList = element<HTMLElement>("#avatar-rule-list");
const resetAvatarRulesButton = element<HTMLButtonElement>("#reset-avatar-rules");
const roomTabLabel = element<HTMLElement>("#room-tab-label");
const windowRoom = element<HTMLElement>("#window-room");
const characterPreview = element<HTMLCanvasElement>("#character-preview");
const emotionWheelHost = element<HTMLElement>("#emotion-wheel");
const importAvatarButton = element<HTMLButtonElement>("#import-avatar");
const avatarFileInput = element<HTMLInputElement>("#avatar-file");
const createAvatarButton = element<HTMLButtonElement>("#create-avatar");
const avatarBuilderDialog = element<HTMLDialogElement>("#avatar-builder-dialog");
const builderNameInput = element<HTMLInputElement>("#builder-name");
const builderCreditInput = element<HTMLInputElement>("#builder-credit");
const builderStyleSelect = element<HTMLSelectElement>("#builder-style");
const builderAuraInput = element<HTMLInputElement>("#builder-aura");
const builderAuraValue = element<HTMLOutputElement>("#builder-aura-value");
const builderAddPosesButton = element<HTMLButtonElement>("#builder-add-poses");
const builderFilesInput = element<HTMLInputElement>("#builder-files");
const builderPoseList = element<HTMLElement>("#builder-pose-list");
const builderStatus = element<HTMLElement>("#builder-status");
const builderClearButton = element<HTMLButtonElement>("#builder-clear");
const builderDownloadButton = element<HTMLButtonElement>("#builder-download");

const avatarCache = new Map<string, Promise<LoadedAvatar>>();
const acceptedHostedAvatars = new Set<string>();
const sessionCustomAvatars = new Set<string>();
const conversation: ConversationLine[] = [];
const frozenPoses = new Map<string, PoseChoice>();
let panelCanvases: HTMLCanvasElement[] = [];
let backdropBitmap: DecodedBitmap;
let backdropCanvas: HTMLCanvasElement;
let backdropGeneration = 0;
let renderGeneration = 0;
let memberGeneration = 0;
let avatarRemapGeneration = 0;
let previewGeneration = 0;
let isAdding = false;
let liveState: LiveState = "offline";
let panelsAcross: PanelsAcross = "auto";
let remoteQueue = Promise.resolve();
const publicRooms = new Map<string, LiveRoomEvent>();
const knownMembers = new Set<string>();
const selectedAddressees = new Set<string>();
const announcedAvatars = new Map<string, AvatarAnnouncement>();
let avatarDisplayPolicy: AvatarDisplayPolicy = { officialOnly: true, artPreference: "none", forced: {} };
let totalPublicRooms = 0;
let currentWheelEmotion: WheelEmotion = { emotion: 0, intensity: 0 };
let suppressWheelChange = false;
let importedAvatarSequence = 0;
const builderPoses: Array<CreatorPose & { filename: string }> = [];
let builderBusy = false;

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

function loadedAvatar(buffer: ArrayBuffer, metadata: AvatarFile): LoadedAvatar {
  return { buffer, metadata, memory: newPoseMemory(), poses: new Map() };
}

async function importLocalAvatar(file: File): Promise<void> {
  if (!file.name.toLocaleLowerCase().endsWith(".avb")) throw new Error("Choose a Comic Chat .avb character file");
  if (sessionCustomAvatars.size >= MAX_SESSION_CUSTOM_AVATARS) throw new Error("This tab already has the maximum of 24 custom avatars");
  setStatus(`Checking ${file.name}…`);
  const buffer = await file.arrayBuffer();
  const imported = await validateAvatarImport(buffer, file.name);
  const key = `local-avatar:${++importedAvatarSequence}`;
  avatarCache.set(key, Promise.resolve(loadedAvatar(buffer, imported.metadata)));
  sessionCustomAvatars.add(key);
  const option = new Option(`${imported.name} — imported`, key);
  characterSelect.append(option);
  characterSelect.value = key;
  resetEmotionWheel();
  await updateCharacterPreview();
  updateControls();
  setStatus(`${imported.name} is now appearing locally. It stays in this tab and is not uploaded or shared.`);
}

function setBuilderStatus(message: string, error = false): void {
  builderStatus.textContent = message;
  builderStatus.classList.toggle("error", error);
}

function updateBuilderControls(): void {
  builderAuraValue.value = `${builderAuraInput.value} px`;
  builderAddPosesButton.disabled = builderBusy;
  builderDownloadButton.disabled = builderBusy || builderPoses.length === 0 || builderNameInput.value.trim().length === 0;
  builderClearButton.disabled = builderBusy || builderPoses.length === 0;
}

function drawBuilderThumbnail(canvas: HTMLCanvasElement, pose: CreatorPose): void {
  const source = document.createElement("canvas");
  source.width = pose.art.width;
  source.height = pose.art.height;
  source.getContext("2d")?.putImageData(
    new ImageData(new Uint8ClampedArray(pose.art.pixels), pose.art.width, pose.art.height),
    0,
    0,
  );
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width - 4) / source.width, (canvas.height - 4) / source.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, (canvas.width - source.width * scale) / 2, canvas.height - source.height * scale - 2, source.width * scale, source.height * scale);
}

function renderBuilderPoses(): void {
  builderPoseList.replaceChildren();
  if (builderPoses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "builder-empty";
    empty.textContent = "No pose images yet.";
    builderPoseList.append(empty);
    updateBuilderControls();
    return;
  }
  builderPoses.forEach((pose, index) => {
    const row = document.createElement("article");
    row.className = "builder-pose-row";
    const preview = document.createElement("canvas");
    preview.width = 54;
    preview.height = 64;
    preview.setAttribute("aria-hidden", "true");
    drawBuilderThumbnail(preview, pose);
    const details = document.createElement("div");
    const filename = document.createElement("strong");
    filename.textContent = pose.filename;
    filename.title = pose.filename;
    const emotion = document.createElement("select");
    emotion.setAttribute("aria-label", `Emotion for ${pose.filename}`);
    for (const [value, label] of BUILDER_EMOTIONS) emotion.append(new Option(label, String(value)));
    emotion.value = String(pose.emotion);
    emotion.addEventListener("change", () => { pose.emotion = Number(emotion.value); });
    const intensityLabel = document.createElement("label");
    intensityLabel.textContent = "Intensity ";
    const intensity = document.createElement("input");
    intensity.type = "range";
    intensity.min = "0";
    intensity.max = "100";
    intensity.value = String(Math.round(pose.intensity * 100));
    const intensityValue = document.createElement("output");
    intensityValue.value = `${intensity.value}%`;
    intensity.addEventListener("input", () => {
      pose.intensity = Number(intensity.value) / 100;
      intensityValue.value = `${intensity.value}%`;
    });
    intensityLabel.append(intensity, intensityValue);
    details.append(filename, emotion, intensityLabel);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${pose.filename}`);
    remove.addEventListener("click", () => {
      builderPoses.splice(index, 1);
      renderBuilderPoses();
      setBuilderStatus(builderPoses.length ? `${builderPoses.length} pose images ready.` : "Add at least one neutral pose.");
    });
    row.append(preview, details, remove);
    builderPoseList.append(row);
  });
  updateBuilderControls();
}

async function addBuilderPoseFiles(files: readonly File[]): Promise<void> {
  if (builderPoses.length + files.length > 16) throw new Error("A character can have at most 16 poses");
  const defaults = [9, 1, 5, 6, 10, 8, 7, 14];
  builderBusy = true;
  updateBuilderControls();
  try {
    for (const file of files) {
      setBuilderStatus(`Reading ${file.name}…`);
      const art = await imageFileToRgba(file);
      const emotion = defaults[builderPoses.length % defaults.length];
      builderPoses.push({ filename: file.name, art, emotion, intensity: emotion === 9 ? 0 : 0.8 });
    }
  } finally {
    builderBusy = false;
    renderBuilderPoses();
  }
  setBuilderStatus(`${builderPoses.length} pose ${builderPoses.length === 1 ? "image" : "images"} ready. Assign the matching emotion to each.`);
}

function downloadAvatar(buffer: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = avatarDownloadName(name);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function buildAndUseAvatar(): Promise<void> {
  if (sessionCustomAvatars.size >= MAX_SESSION_CUSTOM_AVATARS) throw new Error("This tab already has the maximum of 24 custom avatars");
  builderBusy = true;
  updateBuilderControls();
  setBuilderStatus("Building the Comic Chat character…");
  try {
    const name = builderNameInput.value.trim();
    const buffer = await buildSimpleAvatar({
      name,
      credit: builderCreditInput.value,
      style: builderStyleSelect.value === "color" ? "color" : "mono",
      aura: Number(builderAuraInput.value),
      poses: builderPoses,
    });
    const imported = await validateAvatarImport(buffer, avatarDownloadName(name));
    const key = `local-avatar:${++importedAvatarSequence}`;
    avatarCache.set(key, Promise.resolve(loadedAvatar(buffer, imported.metadata)));
    sessionCustomAvatars.add(key);
    characterSelect.append(new Option(`${imported.name} — created`, key));
    characterSelect.value = key;
    resetEmotionWheel();
    await updateCharacterPreview();
    downloadAvatar(buffer, imported.name);
    avatarBuilderDialog.close();
    updateControls();
    setStatus(`${imported.name} was built, selected, and downloaded. It remains local until you host the .avb.`);
  } finally {
    builderBusy = false;
    updateBuilderControls();
  }
}

async function prepareHostedAvatar(nickname: string): Promise<string | undefined> {
  const announcement = announcedAvatars.get(memberAvatarRuleKey(nickname));
  if (!announcement || announcedOfficialFile(nickname) || avatarDisplayPolicy.officialOnly) return undefined;
  const url = sameOriginAvatarUrl(announcement.url, new URL(window.location.href));
  if (!url) return undefined;
  if (acceptedHostedAvatars.has(url)) return url;
  if (sessionCustomAvatars.size >= MAX_SESSION_CUSTOM_AVATARS) throw new Error("This tab already has the maximum of 24 custom avatars");
  const buffer = await fetchAvatarFile(url);
  const imported = await validateAvatarImport(buffer, `${announcement.name}.avb`);
  avatarCache.set(url, Promise.resolve(loadedAvatar(buffer, imported.metadata)));
  acceptedHostedAvatars.add(url);
  sessionCustomAvatars.add(url);
  return url;
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
  const name = characters.find((choice) => choice.file === file)?.label.split(" —")[0] || avatar.name || "Character";
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

function automaticCharacterForNickname(nickname: string): string {
  if (nicknameInput.value && nickname.toLocaleLowerCase() === nicknameInput.value.toLocaleLowerCase()) {
    return characterSelect.value;
  }
  let hash = 2166136261;
  for (const character of nickname.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return monochromeCharacters[Math.abs(hash) % monochromeCharacters.length].file;
}

function memberAvatarRuleKey(nickname: string): string {
  return avatarRuleKey(networkSelect.value, nickname);
}

function announcedOfficialFile(nickname: string): string | undefined {
  const announcement = announcedAvatars.get(memberAvatarRuleKey(nickname));
  return announcement ? officialCharacterByName.get(announcement.name.toLocaleLowerCase()) : undefined;
}

function selectedOfficialAvatarName(): string | undefined {
  const choice = characters.find(({ file }) => file === characterSelect.value);
  return choice?.announcementName ?? choice?.label.split(" —")[0];
}

function preferredAvatarFile(file: string): string {
  return preferAvatarEdition(file, avatarDisplayPolicy.artPreference, avatarEditions);
}

function applyPreferenceToSelectedCharacter(): boolean {
  const preferred = preferredAvatarFile(characterSelect.value);
  if (preferred === characterSelect.value) return false;
  characterSelect.value = preferred;
  return true;
}

function announceSelectedAvatar(): boolean {
  if (!liveClient.joined) return false;
  const name = selectedOfficialAvatarName();
  if (!name) return false;
  liveClient.say(`# Appears as ${name}`);
  return true;
}

function characterForNickname(nickname: string): string {
  if (nicknameInput.value && nickname.toLocaleLowerCase() === nicknameInput.value.toLocaleLowerCase()) {
    return characterSelect.value;
  }
  const announcement = announcedAvatars.get(memberAvatarRuleKey(nickname));
  const hosted = !avatarDisplayPolicy.officialOnly
    ? sameOriginAvatarUrl(announcement?.url, new URL(window.location.href))
    : undefined;
  return resolveAvatarFile({
    network: networkSelect.value,
    nickname,
    forced: avatarDisplayPolicy.forced,
    announcedOfficialFile: announcedOfficialFile(nickname),
    announcedCustomFile: hosted && acceptedHostedAvatars.has(hosted) ? hosted : undefined,
    officialOnly: avatarDisplayPolicy.officialOnly,
    artPreference: avatarDisplayPolicy.artPreference,
    editions: avatarEditions,
    fallbackFile: automaticCharacterForNickname(nickname),
  });
}

function saveAvatarDisplayPolicy(): void {
  try {
    localStorage.setItem("comic-chat-avatar-display-policy", JSON.stringify(avatarDisplayPolicy));
  } catch {}
}

async function refreshMemberAvatars(nicknames?: ReadonlySet<string>): Promise<void> {
  const generation = ++avatarRemapGeneration;
  const replacements = await Promise.all(conversation.map(async (line) => {
    const member = [...knownMembers].find((nickname) => nickname.toLocaleLowerCase() === line.characterName.toLocaleLowerCase());
    if (!member || (nicknames && !nicknames.has(member))) return line;
    const nextFile = characterForNickname(member);
    if (line.characterFile === nextFile) return line;
    return createConversationLine(nextFile, line.message, line.characterName, line.mode, line.talkTo);
  }));
  if (generation !== avatarRemapGeneration) return;
  conversation.splice(0, conversation.length, ...replacements);
  await renderStrip();
}

async function refreshAvatarArtPreference(): Promise<void> {
  const generation = ++avatarRemapGeneration;
  const replacements = await Promise.all(conversation.map(async (line) => {
    const member = [...knownMembers].find((nickname) => nickname.toLocaleLowerCase() === line.characterName.toLocaleLowerCase());
    const nextFile = member ? characterForNickname(member) : preferredAvatarFile(line.characterFile);
    if (line.characterFile === nextFile) return line;
    return createConversationLine(nextFile, line.message, line.characterName, line.mode, line.talkTo);
  }));
  if (generation !== avatarRemapGeneration) return;
  conversation.splice(0, conversation.length, ...replacements);
  await renderStrip();
}

function renderAvatarRules(): void {
  officialAvatarsOnly.checked = avatarDisplayPolicy.officialOnly;
  for (const input of avatarArtPreferenceInputs) input.checked = input.value === avatarDisplayPolicy.artPreference;
  avatarRuleList.replaceChildren();
  const self = nicknameInput.value.trim().toLocaleLowerCase();
  const members = [...knownMembers]
    .filter((nickname) => nickname.toLocaleLowerCase() !== self)
    .sort((left, right) => left.localeCompare(right));
  if (members.length === 0) {
    const empty = document.createElement("p");
    empty.className = "avatar-rule-empty";
    empty.textContent = "Join a room to assign characters to its members.";
    avatarRuleList.append(empty);
    return;
  }

  for (const nickname of members) {
    const label = document.createElement("strong");
    label.textContent = nickname;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Display ${nickname} as`);
    select.append(new Option("Automatic", ""));
    const classicGroup = document.createElement("optgroup");
    classicGroup.label = "Classic & Art Pack";
    for (const character of monochromeCharacters) classicGroup.append(new Option(character.label, character.file));
    const colorGroup = document.createElement("optgroup");
    colorGroup.label = "Color replacements";
    for (const character of colorCharacters) colorGroup.append(new Option(character.label, character.file));
    select.append(classicGroup, colorGroup);
    select.value = avatarDisplayPolicy.forced[memberAvatarRuleKey(nickname)] ?? "";
    select.addEventListener("change", () => {
      const key = memberAvatarRuleKey(nickname);
      if (select.value && officialCharacterFiles.has(select.value)) avatarDisplayPolicy.forced[key] = select.value;
      else delete avatarDisplayPolicy.forced[key];
      saveAvatarDisplayPolicy();
      renderMembers();
      const selected = characters.find(({ file }) => file === select.value)?.label ?? "Automatic";
      setStatus(select.value ? `${nickname} will always appear as ${selected}.` : `${nickname} will use their announced or automatic avatar.`);
      void refreshMemberAvatars(new Set([nickname])).catch(showError);
    });
    avatarRuleList.append(label, select);
  }
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
  const announcement = parseAvatarAnnouncement(event.message);
  if (announcement) {
    announcedAvatars.set(memberAvatarRuleKey(event.nickname), announcement);
    let hostedFile: string | undefined;
    let hostedError: unknown;
    if (!announcedOfficialFile(event.nickname) && !avatarDisplayPolicy.officialOnly) {
      try {
        hostedFile = await prepareHostedAvatar(event.nickname);
      } catch (error) {
        hostedError = error;
      }
    }
    renderMembers();
    renderAvatarRules();
    await refreshMemberAvatars(new Set([event.nickname]));
    const isOfficial = announcedOfficialFile(event.nickname) !== undefined;
    setStatus(isOfficial
      ? `${event.nickname} is now appearing as ${announcement.name}.`
      : avatarDisplayPolicy.officialOnly
        ? `${event.nickname} announced the custom avatar ${announcement.name}; official-only mode kept their local character.`
        : hostedFile
          ? `${event.nickname} is now appearing as the hosted custom avatar ${announcement.name}.`
          : hostedError instanceof Error
            ? `${event.nickname}'s custom avatar was rejected: ${hostedError.message}`
            : `${event.nickname}'s custom avatar is not hosted on this site, so their local character was kept.`);
    return;
  }
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
      const announced = announceSelectedAvatar();
      setStatus(`${event.message}. New channel messages will become panels.${announced ? ` You are appearing as ${selectedOfficialAvatarName()}.` : " Your imported avatar remains local to this tab."}`);
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
  const swapped = applyPreferenceToSelectedCharacter();
  resetEmotionWheel();
  frozenPoses.delete(characterSelect.value);
  updateControls();
  void updateCharacterPreview().then(() => {
    if (!liveClient.joined) {
      if (swapped) setStatus(`Your ${avatarDisplayPolicy.artPreference === "color" ? "color" : "black-and-white"} preference selected the matching edition.`);
      return;
    }
    const announced = announceSelectedAvatar();
    setStatus(announced
      ? `You are now appearing as ${selectedOfficialAvatarName()}.`
      : "Your imported avatar is selected locally, but it cannot be shared until it has an approved webcomicchat.com URL.");
  }).catch(showError);
});
importAvatarButton.addEventListener("click", () => avatarFileInput.click());
avatarFileInput.addEventListener("change", () => {
  const file = avatarFileInput.files?.[0];
  avatarFileInput.value = "";
  if (file) void importLocalAvatar(file).catch(showError);
});
createAvatarButton.addEventListener("click", () => {
  renderBuilderPoses();
  avatarBuilderDialog.showModal();
  builderNameInput.focus();
});
builderNameInput.addEventListener("input", updateBuilderControls);
builderAuraInput.addEventListener("input", updateBuilderControls);
builderAddPosesButton.addEventListener("click", () => builderFilesInput.click());
builderFilesInput.addEventListener("change", () => {
  const files = [...(builderFilesInput.files ?? [])];
  builderFilesInput.value = "";
  if (files.length) void addBuilderPoseFiles(files).catch((error) => {
    setBuilderStatus(error instanceof Error ? error.message : "Could not read those pose images", true);
    updateBuilderControls();
  });
});
builderClearButton.addEventListener("click", () => {
  builderPoses.length = 0;
  renderBuilderPoses();
  setBuilderStatus("Add at least one neutral pose.");
});
builderDownloadButton.addEventListener("click", () => {
  void buildAndUseAvatar().catch((error) => {
    setBuilderStatus(error instanceof Error ? error.message : "Could not build the avatar", true);
    updateBuilderControls();
  });
});
messageMode.addEventListener("change", updateControls);
function horizontalPadding(target: Element): number {
  const style = getComputedStyle(target);
  return Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
}

function updatePanelView(): void {
  panelsAcross = parsePanelsAcross(panelsAcrossSelect.value);
  const percent = parsePanelZoom(panelSizeInput.value);
  const stage = strip.closest<HTMLElement>(".stage-wrap");
  const stripStyle = getComputedStyle(strip);
  const gap = Number.parseFloat(stripStyle.columnGap) || 0;
  const availableWidth = stage
    ? stage.clientWidth - horizontalPadding(stage) - horizontalPadding(strip)
    : strip.clientWidth - horizontalPadding(strip);
  const displaySize = panelDisplaySize(availableWidth, panelsAcross, percent, PANEL_PIXELS, gap);

  strip.style.setProperty("--panel-display-size", `${displaySize}px`);
  if (panelsAcross === "auto") {
    delete strip.dataset.panelsAcross;
    strip.style.removeProperty("--panels-across");
  } else {
    strip.dataset.panelsAcross = String(panelsAcross);
    strip.style.setProperty("--panels-across", String(panelsAcross));
  }
  panelSizeValue.value = `${percent}%`;
  panelSizeValue.title = panelsAcross === "auto"
    ? `${Math.round(displaySize)} pixels; automatic wrapping`
    : `${Math.round(displaySize)} pixels; ${panelsAcross} across`;

  try {
    localStorage.setItem("comic-chat-panels-across", String(panelsAcross));
    localStorage.setItem("comic-chat-panel-size", String(percent));
  } catch {}
}

panelsAcrossSelect.addEventListener("change", updatePanelView);
panelSizeInput.addEventListener("input", updatePanelView);
const stage = strip.closest<HTMLElement>(".stage-wrap");
if (stage && "ResizeObserver" in window) new ResizeObserver(updatePanelView).observe(stage);
else window.addEventListener("resize", updatePanelView);
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
avatarRulesButton.addEventListener("click", () => {
  renderAvatarRules();
  avatarRulesDialog.showModal();
});
officialAvatarsOnly.addEventListener("change", () => {
  avatarDisplayPolicy.officialOnly = officialAvatarsOnly.checked;
  saveAvatarDisplayPolicy();
  void (async () => {
    let loaded = 0;
    let rejected = 0;
    if (!avatarDisplayPolicy.officialOnly) {
      for (const nickname of knownMembers) {
        try {
          if (await prepareHostedAvatar(nickname)) loaded += 1;
        } catch {
          rejected += 1;
        }
      }
    }
    renderMembers();
    await refreshMemberAvatars();
    setStatus(avatarDisplayPolicy.officialOnly
      ? "Official-only mode is on. Room-provided custom art will be ignored."
      : `Official-only mode is off. ${loaded} hosted custom ${loaded === 1 ? "avatar" : "avatars"} loaded${rejected ? `; ${rejected} rejected` : ""}.`);
  })().catch(showError);
});
for (const input of avatarArtPreferenceInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    avatarDisplayPolicy.artPreference = input.value as AvatarArtPreference;
    saveAvatarDisplayPolicy();
    const selfChanged = applyPreferenceToSelectedCharacter();
    resetEmotionWheel();
    renderMembers();
    void (async () => {
      await Promise.all([updateCharacterPreview(), refreshAvatarArtPreference()]);
      if (selfChanged && liveClient.joined) announceSelectedAvatar();
      const label = avatarDisplayPolicy.artPreference === "none"
        ? "No art preference"
        : avatarDisplayPolicy.artPreference === "color"
          ? "Color preference"
          : "Black-and-white preference";
      setStatus(`${label} saved. Matching character editions have been updated; forced member mappings were preserved.`);
    })().catch(showError);
  });
}
resetAvatarRulesButton.addEventListener("click", () => {
  avatarDisplayPolicy.forced = {};
  saveAvatarDisplayPolicy();
  renderAvatarRules();
  renderMembers();
  setStatus("All forced member-avatar mappings were reset.");
  void refreshMemberAvatars().catch(showError);
});

nicknameInput.value = `Comic${Math.floor(1000 + Math.random() * 9000)}`;
try {
  avatarDisplayPolicy = parseAvatarDisplayPolicy(localStorage.getItem("comic-chat-avatar-display-policy"), officialCharacterFiles);
  panelsAcrossSelect.value = String(parsePanelsAcross(localStorage.getItem("comic-chat-panels-across")));
  panelSizeInput.value = String(parsePanelZoom(localStorage.getItem("comic-chat-panel-size")));
} catch {}
updatePanelView();
const linkedRoom = roomSelectionFromUrl(new URL(window.location.href));
if (linkedRoom) {
  networkSelect.value = linkedRoom.network;
  channelInput.value = linkedRoom.channel;
  liveStatus.textContent = `Room ready: ${linkedRoom.channel}`;
}
updateControls();
void initialLoad();
