import { addressedText, parseAddressing, withoutAiMarker } from "./addressing";
import "@fontsource/comic-neue/400.css";
import "@fontsource/comic-neue/400-italic.css";
import comicNeueLicenseUrl from "@fontsource/comic-neue/LICENSE?url";
import classicAppIconUrl from "../../v2.5-beta-1-modern/res/chat.ico?url";
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
  buildCompositeAvatar,
  buildSimpleAvatar,
  imageFileToRgba,
  type CreatorPartPose,
  type CreatorPose,
} from "./avatar-creator";
import { bodyForText, composeChoice, type ComposedBody } from "./composite";
import { createEmotionWheel, posesForWheel, type WheelEmotion } from "./emotion-wheel";
import { choosePoses, describeOptions, EM, emotionOptions, newPoseMemory, type PoseChoice, type PoseMemory } from "./expression";
import { IrcWebClient, type LiveEvent, type LiveMessageEvent, type LiveRoomEvent, type LiveState } from "./irc-client";
import { balloonFontMetrics, type BalloonMode } from "./layout/balloon";
import { ComicPage, type ComicLine, type PanelLayout } from "./layout/page";
import { canvasMeasurer, drawPanel, drawTitlePanel } from "./layout/render";
import { layoutTitlePanel } from "./layout/title";
import { panelDisplaySize, parsePanelsAcross, parsePanelZoom, type PanelsAcross } from "./panel-view";
import {
  createLiberaWebChatUrl,
  createRoomUrl,
  DEFAULT_ROOM_SELECTION,
  normalizeRoomSelection,
  roomSelectionFromUrl,
  type RoomSelection,
} from "./room-link";
import {
  addRoomBookmark,
  isDefaultRoomBookmark,
  parseRoomBookmarks,
  removeRoomBookmark,
  roomBookmarkKey,
  ROOM_BOOKMARKS_STORAGE_KEY,
  serializeRoomBookmarks,
} from "./room-bookmarks";
import { stripExportGrid } from "./strip-export";
import {
  FILTERABLE_COMIC_BOTS,
  isComicBotNickname,
  normalizedComicNickname,
  parseHiddenComicBots,
  visibleComicLines,
} from "./comic-filter";
import { reconcilePanelSelection, selectedPanelIndexes } from "./panel-selection";
import { shouldFollowLatest } from "./scroll-follow";
import { blockedLinkMessage, blockedMessageLink, displayMessageLinks } from "./message-links";
import { censorComicText } from "./content-censor";
import { convertGenerationScript, generationBrief, type GenerationCatalog } from "./generation-script";
import { parseSlashCommand, SLASH_HELP } from "./slash-commands";
import { describePanel, transcriptLine } from "./panel-text";
import { parseComicChatAnnotation, poseForAnnotation, type ComicChatAnnotation } from "./cc-annotation";
import { TabAttention, chime, desktopPermission, requestDesktopPermission, showDesktop } from "./attention";
import {
  NotifyPolicy,
  loadNotifySettings,
  notificationsSleeping,
  parseWatchList,
  saveNotifySettings,
  type Alert,
  type NotifyMode,
} from "./notifications";
import {
  COMIC_FONT_OPTIONS,
  comicFontOption,
  loadComicFonts,
  parseComicFontId,
  type ComicFontId,
} from "./comic-font";
import {
  createStudioProject,
  parseStudioProject,
  studioProjectJson,
  type StudioProject,
  type StudioProjectLine,
} from "./studio-project";
import { studioEntryNeedsDisconnect } from "./studio-entry";
import communityAvatarCatalogSource from "../../community-avatars/catalog.json";
import { parseCommunityAvatarCatalog, type CommunityAvatarEntry } from "./community-avatars";
import { validateBackdropImport } from "./backdrop-import";

interface ArtChoice { file: string; label: string; announcementName?: string }
interface HostedCommunityAvatar extends CommunityAvatarEntry { fileUrl: string }

const COLOR_REPLACEMENT_CREDIT_URL = "https://www.phoenix-online-nexus.com/Nexus_21/index.htm#instructionsavb";
const MICROSOFT_OPEN_SOURCE_URL = "https://opensource.microsoft.com/blog/2026/07/16/microsoft-comic-chat-is-now-open-source/";
const HIDE_BOT_COMMANDS: Readonly<Record<string, string>> = {
  "hide-bettybot": "BettyBot",
  "hide-tonguetiedbot": "TongueTiedBot",
  "hide-n00bbot": "n00bBot",
};

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

const communityAvatarAssets = import.meta.glob("../../community-avatars/*.{avb,AVB}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const bundledCommunityAvatars: HostedCommunityAvatar[] = parseCommunityAvatarCatalog(communityAvatarCatalogSource).avatars
  .flatMap((entry) => {
    const fileUrl = communityAvatarAssets[`../../community-avatars/${entry.file}`];
    return fileUrl ? [{ ...entry, fileUrl }] : [];
  });
let communityAvatars: HostedCommunityAvatar[] = [...bundledCommunityAvatars];

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
  { file: artPack("kevin.avb"), label: "Kevin — black-and-white" },
  { file: artPack("kwensa.avb"), label: "Kwensa — Art Pack" },
  { file: artPack("maynard.avb"), label: "Maynard — black-and-white" },
  { file: artPack("rebecca.avb"), label: "Rebecca — black-and-white" },
  { file: artPack("sage.avb"), label: "Sage — black-and-white" },
  { file: artPack("scotty.avb"), label: "Scotty — black-and-white" },
  { file: artPack("bolo.avb"), label: "Bolo — alternate art" },
  { file: artPack("cro.avb"), label: "Cro — alternate art" },
  { file: artPack("denise.avb"), label: "Denise — alternate art" },
  { file: artPack("lynnea.avb"), label: "Lynnea — alternate art" },
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
  label: `${name} — color`,
  announcementName: source.replace(/\.AVB$/u, ""),
}));
const characters: ArtChoice[] = [...monochromeCharacters, ...colorCharacters];
const artPackStudioIds = new Map(Object.entries(artPackAssets).map(([path, url]) => [
  url,
  `art-pack:${path.split("/").at(-1)?.toLocaleLowerCase()}`,
]));
const studioCharacterIdByFile = new Map<string, string>();
const studioCharacterFileById = new Map<string, string>();
for (const choice of characters) {
  const id = choice.announcementName
    ? `color:${choice.announcementName.toLocaleLowerCase()}`
    : artPackStudioIds.get(choice.file) ?? `classic:${choice.file.toLocaleLowerCase()}`;
  studioCharacterIdByFile.set(choice.file, id);
  studioCharacterFileById.set(id, choice.file);
}
const characterOptionMarkup = `
  <optgroup label="Black &amp; white / alternate art">
    ${monochromeCharacters.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}
  </optgroup>
  <optgroup label="Color editions">
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
const studioBackdropIdByFile = new Map<string, string>();
const studioBackdropFileById = new Map<string, string>();
for (const choice of backdrops) {
  const id = artPackStudioIds.get(choice.file) ?? `classic:${choice.file.toLocaleLowerCase()}`;
  studioBackdropIdByFile.set(choice.file, id);
  studioBackdropFileById.set(id, choice.file);
}

const PANEL_TWIPS = 4860;
const PANEL_SCALE = 1 / 15;
const PANEL_PIXELS = PANEL_TWIPS * PANEL_SCALE;
const MAX_LIVE_LINES = 48;
const MAX_SESSION_CUSTOM_AVATARS = 24;
const MAX_SESSION_CUSTOM_BACKDROPS = 12;
const STUDIO_AUTOSAVE_KEY = "webcomicchat-studio-autosave-v1";
const STUDIO_AUTOSAVE_TIME_KEY = "webcomicchat-studio-autosave-time-v1";

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
  displayMessage: string;
  links: ReturnType<typeof displayMessageLinks>["links"];
  mode: BalloonMode;
  body: ComposedBody;
  poseRef: string;
  expression: string;
  talkTo: string[];
  linkable: boolean;
  breakBefore?: boolean;
  stayInPanel?: boolean;
  reaction?: boolean;
  studioPose?: StudioPoseId;
  /** Offline Studio pacing shot containing only the selected backdrop. */
  blankPanel?: boolean;
}

type StudioPoseId = "auto" | "neutral" | "happy" | "coy" | "bored" | "scared" | "sad" | "angry" | "shout" | "laugh" | "wave" | "point-other" | "point-self" | "shrug";
type StudioPlacement = "new" | "current" | "auto";

interface WorkshopPanelSummary {
  characters: Array<{ name: string; silent: boolean }>;
  balloons: Array<{ speaker: string; text: string }>;
}

interface StudioSnapshot {
  title: string;
  backgroundFile: string;
  fontId: ComicFontId;
  lines: ConversationLine[];
}

const STUDIO_POSES: ReadonlyArray<{ id: StudioPoseId; label: string }> = [
  { id: "auto", label: "Automatic (from words)" },
  { id: "neutral", label: "Neutral" },
  { id: "happy", label: "Happy" },
  { id: "coy", label: "Coy / wink" },
  { id: "bored", label: "Bored" },
  { id: "scared", label: "Scared" },
  { id: "sad", label: "Sad" },
  { id: "angry", label: "Angry" },
  { id: "shout", label: "Shouting" },
  { id: "laugh", label: "Laughing" },
  { id: "wave", label: "Wave" },
  { id: "point-other", label: "Point outward" },
  { id: "point-self", label: "Point at self" },
  { id: "shrug", label: "Shrug" },
];

const STUDIO_WHEEL_EMOTIONS: Partial<Record<StudioPoseId, number>> = {
  neutral: EM.NEUTRAL,
  happy: EM.HAPPY,
  coy: EM.COY,
  bored: EM.BORED,
  scared: EM.SCARED,
  sad: EM.SAD,
  angry: EM.ANGRY,
  shout: EM.SHOUT,
  laugh: EM.LAUGH,
};

const STUDIO_GESTURES: Partial<Record<StudioPoseId, number>> = {
  wave: EM.WAVE,
  "point-other": EM.POINTOTHER,
  "point-self": EM.POINTSELF,
  shrug: EM.SHRUG,
};

interface PendingLiveLine {
  line: ConversationLine;
  sentNote: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application mount point is missing");
const comicFontOptionsMarkup = COMIC_FONT_OPTIONS
  .map(({ id, label }) => `<option value="${id}">${label}</option>`)
  .join("");

app.innerHTML = `
  <div id="classic-window" class="classic-window">
    <header id="classic-titlebar" class="classic-titlebar">
      <button id="system-menu-button" class="classic-app-menu-button" type="button" aria-label="Open window menu" aria-haspopup="menu" aria-expanded="false"><img class="classic-app-icon" src="${classicAppIconUrl}" alt="" /></button>
      <div id="system-menu" class="system-menu classic-menu-popup" role="menu" hidden>
        <button type="button" role="menuitem" data-window-action="restore">Restore</button>
        <button type="button" role="menuitem" disabled>Move</button>
        <button type="button" role="menuitem" disabled>Size</button>
        <button type="button" role="menuitem" data-window-action="minimize">Minimize</button>
        <button type="button" role="menuitem" data-window-action="maximize">Maximize</button>
        <hr />
        <button type="button" role="menuitem" data-window-action="close">Close</button>
        <hr />
        <button type="button" role="menuitem" data-command="about">About WebComicChat…</button>
      </div>
      <strong>WebComicChat - [<span id="window-room">Not connected</span>]</strong>
      <span class="window-buttons">
        <button id="window-minimize" type="button" aria-label="Minimize">_</button>
        <button id="window-maximize" type="button" aria-label="Maximize">□</button>
        <button id="window-close" type="button" aria-label="Close">×</button>
      </span>
    </header>
    <nav id="classic-menu" class="classic-menu" aria-label="Application menu">
      <details><summary><u>F</u>ile</summary><div class="classic-menu-popup">
        <button type="button" data-command="new-comic">New comic</button>
        <button type="button" data-command="strip-workshop">Open Offline Comic Studio…</button>
        <button type="button" data-command="import-avatar">Import character…</button>
        <button type="button" data-command="import-background">Import background…</button>
        <button type="button" data-command="create-avatar">Create character…</button>
        <hr />
        <button type="button" role="menuitemcheckbox" data-command="select-panels">Select panels to save…</button>
        <button type="button" data-command="save-comic">Save comic…</button>
      </div></details>
      <details><summary><u>E</u>dit</summary><div class="classic-menu-popup">
        <button type="button" data-command="undo">Undo last line</button>
        <button type="button" data-command="clear">Clear comic</button>
        <hr />
        <button type="button" data-command="write-message">Write a message</button>
      </div></details>
      <details><summary><u>V</u>iew</summary><div class="classic-menu-popup">
        <button type="button" data-command="browse-channels">Browse channels…</button>
        <hr />
        <button type="button" role="menuitemcheckbox" data-command="hide-bettybot">Hide BettyBot from comic &amp; saved PNGs</button>
        <button type="button" role="menuitemcheckbox" data-command="hide-tonguetiedbot">Hide TongueTiedBot from comic &amp; saved PNGs</button>
        <button type="button" role="menuitemcheckbox" data-command="hide-n00bbot">Hide n00bBot from comic &amp; saved PNGs</button>
        <hr />
        <button type="button" role="menuitemcheckbox" data-command="plain-text-view">Plain text view</button>
        <button type="button" role="menuitemcheckbox" data-command="censor-content">Censor mature &amp; sensitive text</button>
        <hr />
        <button type="button" data-command="notifications">Notifications…</button>
        <hr />
        <button type="button" data-command="auto-panels">Automatic panel wrapping</button>
        <button type="button" data-command="reset-zoom">Reset zoom to 100%</button>
      </div></details>
      <details><summary>F<u>o</u>rmat</summary><div class="classic-menu-popup">
        <button type="button" role="menuitemradio" data-command="mode-say">Say balloon</button>
        <button type="button" role="menuitemradio" data-command="mode-think">Thought balloon</button>
        <button type="button" role="menuitemradio" data-command="mode-whisper">Whisper balloon</button>
        <button type="button" role="menuitemradio" data-command="mode-action">Action box</button>
        <hr />
        <button type="button" data-command="choose-font">Choose balloon font…</button>
      </div></details>
      <details><summary><u>R</u>oom</summary><div class="classic-menu-popup room-menu-popup">
        <button type="button" data-command="join-channel">Join/Switch typed channel</button>
        <button type="button" data-command="browse-channels">Browse channels…</button>
        <button type="button" data-command="copy-channel">Copy channel link</button>
        <hr />
        <button type="button" data-command="bookmark-room">Bookmark typed/current room</button>
        <button type="button" data-command="manage-room-bookmarks">Manage room bookmarks…</button>
        <span class="classic-menu-label">Bookmarked rooms</span>
        <div id="room-bookmark-menu-list" class="room-bookmark-menu-list"></div>
        <hr />
        <button type="button" data-command="disconnect">Disconnect</button>
      </div></details>
      <details><summary><u>C</u>haracter</summary><div class="classic-menu-popup">
        <button type="button" data-command="choose-character">Choose your character</button>
        <button type="button" data-command="community-avatars">Browse community avatars…</button>
        <button type="button" data-command="avatar-rules">Avatar display rules…</button>
      </div></details>
      <details id="favorites-menu"><summary>F<u>a</u>vorites</summary><div class="classic-menu-popup classic-menu-popup-right">
        <a href="https://www.phoenix-online-nexus.com/Nexus_21/index.htm#addon" target="_blank" rel="noopener noreferrer">Comic Chat 2.5 add-ons ↗</a>
        <a href="https://www.phoenix-online-nexus.com/index.htm#CChat25" target="_blank" rel="noopener noreferrer">Phoenix Online Nexus ↗</a>
        <a href="https://comic.dedoky.com/catalog.php" target="_blank" rel="noopener noreferrer">Dedoky character catalog ↗</a>
        <a href="https://mermeliz.com" target="_blank" rel="noopener noreferrer">Mermeliz ↗</a>
        <hr />
        <a href="https://web.libera.chat" target="_blank" rel="noopener noreferrer">Libera.Chat web client ↗</a>
      </div></details>
      <details><summary><u>H</u>elp</summary><div class="classic-menu-popup classic-menu-popup-right">
        <button type="button" data-command="comic-tips">Comic tips (F1)</button>
        <button type="button" data-command="bot-tips">Bot tips…</button>
        <button type="button" data-command="chat-commands">Chat commands…</button>
        <button type="button" data-command="notification-help">Notification help…</button>
        <hr />
        <button type="button" data-command="about">About WebComicChat…</button>
        <a href="mailto:admin@webcomicchat.com">Email WebComicChat…</a>
        <a href="${MICROSOFT_OPEN_SOURCE_URL}" target="_blank" rel="noopener noreferrer">Microsoft open-source release ↗</a>
      </div></details>
    </nav>

    <main class="classic-main">
      <section id="live-console" class="live-console" data-state="offline" aria-label="IRC connection">
        <div class="live-heading">
          <span id="live-dot" class="live-dot"></span>
          <span><small>Connection</small><strong id="live-status">Offline — not connected</strong></span>
        </div>
        <label>Server<select id="network"><option value="libera">Libera.Chat</option><option value="oftc">OFTC</option></select></label>
        <label>Nickname<input id="nickname" maxlength="16" autocomplete="nickname" /></label>
        <label>Channel<input id="channel" maxlength="52" value="${DEFAULT_ROOM_SELECTION.channel}" placeholder="#channel" spellcheck="false" /></label>
        <div class="live-actions">
          <button id="connect-live" class="connect-button" type="button">Join ${DEFAULT_ROOM_SELECTION.channel}</button>
          <button id="browse-rooms" type="button">Browse channels…</button>
          <button id="share-room" class="share-room-button" type="button">Copy channel link</button>
          <button id="disconnect-live" type="button" disabled>Disconnect</button>
          <a id="libera-web-chat" class="libera-web-chat" href="${createLiberaWebChatUrl(DEFAULT_ROOM_SELECTION.channel)}" target="_blank" rel="noreferrer">Open ${DEFAULT_ROOM_SELECTION.channel} in Libera web chat ↗</a>
        </div>
        <p id="connection-guidance" class="connection-guidance" role="status"><strong>You’re offline.</strong> Choose a nickname, then join ${DEFAULT_ROOM_SELECTION.channel} to start chatting.</p>
      </section>

      <section id="room-browser" class="room-browser" hidden aria-label="Public room directory">
        <header><strong>Channel List</strong><span id="room-summary">Connecting to server…</span><button id="close-room-browser" type="button">Close</button></header>
        <div class="room-tools">
          <label for="room-filter">Find:</label><input id="room-filter" type="search" placeholder="Search room names and topics" />
          <button id="refresh-rooms" type="button">Refresh List</button>
        </div>
        <div class="room-columns"><span>Channel</span><span>Members</span><span>Topic</span></div>
        <div id="room-list" class="room-list" role="list"></div>
        <p>Double-click a channel—or use Join—to enter it. You can always type another channel above and choose Join/Switch.</p>
      </section>

      <div class="room-tab"><span aria-hidden="true">▰</span><strong id="room-tab-label">Offline comic</strong><button id="open-strip-workshop" type="button">Open Comic Studio…</button></div>
      <section id="workspace" class="workspace" aria-label="Comic conversation editor">
        <div class="stage-wrap conversation-stage">
          <div class="strip-heading">
            <span>Comic view</span>
            <div class="view-options">
              <label class="font-choice" for="balloon-font">Font
                <select id="balloon-font">${comicFontOptionsMarkup}</select>
              </label>
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
          <div id="panel-selection-bar" class="panel-selection-bar" role="toolbar" aria-label="Choose panels for saved comic" hidden>
            <strong>Choose panels</strong>
            <span id="panel-selection-count" aria-live="polite">Tap the panels you want to save.</span>
            <button id="select-all-panels" type="button">Select all</button>
            <button id="clear-panel-selection" type="button">Clear</button>
            <button id="save-selected-panels" type="button" disabled>Save selected</button>
            <button id="finish-panel-selection" type="button">Done</button>
          </div>
          <div id="strip" class="comic-strip"></div>
          <ol id="text-view" class="text-view" aria-label="Chat as plain text" hidden></ol>
          <div id="chat-announcer" class="visually-hidden" role="log" aria-live="polite" aria-label="New chat lines"></div>
        </div>

        <aside class="controls">
          <section id="character-pane" class="character-pane">
            <header>
              <button id="character-pane-toggle" class="pane-toggle" type="button" aria-expanded="true" aria-controls="character-pane-content"><span aria-hidden="true">▼</span>Your character</button>
              <button id="character-pane-size" type="button" aria-pressed="false">Enlarge</button>
            </header>
            <div id="character-pane-content" class="character-pane-content">
              <canvas id="character-preview" class="character-figure" width="200" height="108" aria-label="Selected Comic Chat character"></canvas>
              <label for="character">Character</label>
              <select id="character">${characterOptionMarkup}</select>
              <div class="character-actions">
                <button id="community-avatars" type="button">Gallery…</button>
                <button id="import-avatar" type="button">Import .avb…</button>
                <button id="create-avatar" type="button">Create…</button>
                <input id="avatar-file" class="visually-hidden" type="file" accept=".avb,application/octet-stream" />
              </div>
              <small class="local-avatar-note">Gallery characters are hosted here; file imports stay only in this browser tab.</small>
              <label for="backdrop">Background</label>
              <select id="backdrop">${backdrops.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select>
              <div class="backdrop-actions">
                <button id="import-backdrop" type="button">Import .bgb or image…</button>
                <input id="backdrop-file" class="visually-hidden" type="file" accept=".bgb,application/octet-stream,image/png,image/jpeg,image/webp" />
              </div>
              <small class="local-backdrop-note">Custom backgrounds stay in this browser tab and are included in saved comic PNGs.</small>
              <div id="emotion-wheel" class="emotion-wheel" aria-label="Emotion wheel"></div>
              <strong id="tone-value" class="tone-value">Neutral</strong>
              <small id="tone-reason">No expression cues</small>
            </div>
          </section>
          <section id="member-pane" class="member-pane">
            <header>
              <button id="member-pane-toggle" class="pane-toggle" type="button" aria-expanded="true" aria-controls="member-pane-content"><span aria-hidden="true">▼</span>Members</button>
              <button id="avatar-rules-button" type="button">Avatars…</button>
              <small id="member-target-summary">Select who you are talking to</small>
            </header>
            <div id="member-pane-content" class="member-pane-content">
              <div id="member-list" class="member-list"><p>Connect to see room members.</p></div>
            </div>
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
          <button id="select-panels" class="small-action" type="button" aria-pressed="false">Select Panels…</button>
          <button id="download" class="download-button" type="button" disabled>Save Comic</button>
        </div>
      </section>
      <footer class="classic-statusbar">
        <p id="status" class="status" role="status">Loading original art…</p>
        <span>Original Comic Chat art and expression rules · <a href="${COLOR_REPLACEMENT_CREDIT_URL}" target="_blank" rel="noreferrer">color editions credit</a> · <a href="${comicNeueLicenseUrl}" target="_blank" rel="noreferrer">font notice</a></span>
      </footer>
    </main>
    <dialog id="about-dialog" class="classic-dialog about-dialog" aria-labelledby="about-title">
      <form method="dialog">
        <header><strong id="about-title">About WebComicChat</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body about-body">
          <img class="about-icon" src="${classicAppIconUrl}" alt="" />
          <div>
            <strong>WebComicChat</strong>
            <p>An independent, community-built revival of the classic Comic Chat experience for modern browsers.</p>
            <p>Crafted using <a href="${MICROSOFT_OPEN_SOURCE_URL}" target="_blank" rel="noopener noreferrer">Microsoft's open-source Comic Chat release</a>, with support from other great online communities.</p>
            <p>Questions, ideas, or help: <a href="mailto:admin@webcomicchat.com">admin@webcomicchat.com</a></p>
            <p>Not affiliated with or endorsed by Microsoft.</p>
          </div>
        </div>
        <footer><a href="${MICROSOFT_OPEN_SOURCE_URL}" target="_blank" rel="noopener noreferrer">Microsoft open-source release</a><button value="cancel">OK</button></footer>
      </form>
    </dialog>
    <dialog id="bot-tips-dialog" class="classic-dialog bot-tips-dialog" aria-labelledby="bot-tips-title">
      <form method="dialog">
        <header><strong id="bot-tips-title">Chatting with the bots</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body bot-tips-body">
          <p><strong>Bots only answer when you talk directly to them.</strong></p>
          <ol>
            <li>Select a bot in <strong>Members</strong>, then send a normal message; or</li>
            <li>Start the message with its name, such as <code>TongueTiedBot: tell me about Comic Chat</code>.</li>
          </ol>
          <dl>
            <dt>BettyBot</dt><dd>A command-based helper. Try <code>BettyBot: help</code>, <code>tips</code>, <code>fact</code>, <code>show happy</code>, or focused help words such as <code>privacy</code>, <code>studio</code>, <code>notifications</code>, and <code>cyber</code>.</dd>
            <dt>TongueTiedBot</dt><dd>A friendly conversational AI bot. Address it by name and ask a question.</dd>
            <dt>n00bBot</dt><dd>A deliberately silly conversational AI gremlin. Address it by name; say <code>n00bBot: go away</code> to quiet it for an hour.</dd>
          </dl>
          <p id="bot-tips-presence" class="bot-tips-presence" role="status"></p>
          <small>Only bots shown in Members are currently available. AI-generated replies are identified on IRC.</small>
        </div>
        <footer><button value="cancel">OK</button></footer>
      </form>
    </dialog>
    <dialog id="notification-dialog" class="classic-dialog notification-dialog" aria-labelledby="notification-title">
      <form method="dialog">
        <header><strong id="notification-title">Chat notifications</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body notification-body">
          <p><strong>Alerts work only while this WebComicChat tab remains open.</strong> Desktop alerts also require browser permission and HTTPS.</p>
          <fieldset class="notification-modes">
            <legend>Notify me about</legend>
            <label><input type="radio" name="notification-mode" value="off" /> Nothing (Off)</label>
            <label><input type="radio" name="notification-mode" value="wake" /> Room wake-up, mentions, and whispers</label>
            <small>Room wake-up alerts once when people start talking after at least five quiet minutes.</small>
            <label><input type="radio" name="notification-mode" value="mentions" /> Mentions and whispers only</label>
          </fieldset>
          <label class="notification-check"><input id="notification-sound" type="checkbox" /> Play a short chime with an alert</label>
          <section class="notification-sleep">
            <strong>Snooze alerts</strong>
            <output id="notification-sleep-status">Not snoozed</output>
            <div>
              <button id="notification-sleep-hour" type="button">1 hour</button>
              <button id="notification-sleep-eight" type="button">8 hours</button>
              <button id="notification-resume" type="button">Resume now</button>
            </div>
            <small>Snooze pauses sound and desktop pop-ups but keeps the unread tab count.</small>
          </section>
          <label class="notification-watch" for="notification-watch"><strong>Logon Notifications</strong><span>Tell me when these nicknames enter the room (one per line or comma-separated):</span></label>
          <textarea id="notification-watch" rows="3" maxlength="800" spellcheck="false" placeholder="Anna, Dan"></textarea>
          <p id="notification-permission" class="notification-permission" role="status"></p>
        </div>
        <footer><button id="notification-save" type="button">Save</button><button value="cancel">Cancel</button></footer>
      </form>
    </dialog>
    <dialog id="chat-commands-dialog" class="classic-dialog chat-commands-dialog" aria-labelledby="chat-commands-title">
      <form method="dialog">
        <header><strong id="chat-commands-title">Chat commands</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body chat-commands-body">
          <p>Type these in the Message box. Commands are interpreted locally; only the resulting message is sent.</p>
          <dl>
            <dt><code>/me waves</code></dt><dd>Narration/action box</dd>
            <dt><code>/think hmm</code></dt><dd>Thought balloon</dd>
            <dt><code>/whisper Anna psst</code></dt><dd>Private Comic Chat whisper</dd>
            <dt><code>/join #room</code></dt><dd>Join or switch rooms</dd>
            <dt><code>/clear</code></dt><dd>Clear the local comic</dd>
            <dt><code>/quit</code></dt><dd>Disconnect from IRC</dd>
            <dt><code>//text</code></dt><dd>Send ordinary text beginning with /</dd>
          </dl>
        </div>
        <footer><button value="cancel">OK</button></footer>
      </form>
    </dialog>
    <dialog id="room-bookmarks-dialog" class="classic-dialog room-bookmarks-dialog" aria-labelledby="room-bookmarks-title">
      <form method="dialog">
        <header><strong id="room-bookmarks-title">Room bookmarks</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body">
          <p>Bookmarks are saved only in this browser. Libera.Chat ${DEFAULT_ROOM_SELECTION.channel} is always pinned as the WebComicChat home room.</p>
          <div id="room-bookmark-dialog-list" class="room-bookmark-dialog-list"></div>
        </div>
        <footer><button value="cancel">Close</button></footer>
      </form>
    </dialog>
    <dialog id="community-avatars-dialog" class="classic-dialog community-avatars-dialog" aria-labelledby="community-avatars-title">
      <form method="dialog">
        <header><strong id="community-avatars-title">Community Avatars</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body">
          <p>These characters are uploaded directly by the community. WebComicChat checks that each file is a working version 2 Comic Chat avatar, but uploads are not reviewed before they appear.</p>
          <p class="community-avatar-rules"><strong>Keep it suitable for a general audience.</strong> Do not upload nudity or sexual content, photos or depictions of real people, hateful or racist material, harassment, graphic violence, illegal content, personal information, or work you do not have the right to share. Uploads are public and may be removed without notice.</p>
          <div class="community-avatar-toolbar"><button id="community-avatar-upload-open" type="button">Upload an .avb…</button><span id="community-avatar-catalog-status" role="status"></span></div>
          <div id="community-avatar-list" class="community-avatar-list"></div>
          <p class="community-avatar-submit">See something that breaks these rules? Use its Report button. For legal or urgent concerns, email <a href="mailto:admin@webcomicchat.com?subject=Community%20avatar%20concern">admin@webcomicchat.com</a>.</p>
        </div>
        <footer><button value="cancel">Close</button></footer>
      </form>
    </dialog>
    <dialog id="community-avatar-upload-dialog" class="classic-dialog community-avatar-upload-dialog" aria-labelledby="community-avatar-upload-title">
      <form method="dialog">
        <header><strong id="community-avatar-upload-title">Upload a Community Avatar</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body community-avatar-form">
          <p>Your avatar becomes public immediately after automatic technical validation. This check cannot determine whether artwork is appropriate or whether you own it.</p>
          <label>.avb file<input id="community-avatar-upload-file" type="file" accept=".avb,application/octet-stream" required /></label>
          <label>Display name<input id="community-avatar-upload-name" maxlength="60" placeholder="Uses the name inside the .avb when blank" /></label>
          <label>Creator or credit<input id="community-avatar-upload-creator" maxlength="80" placeholder="Optional" /></label>
          <label>Description<textarea id="community-avatar-upload-description" maxlength="240" rows="3" placeholder="Optional"></textarea></label>
          <label>Source or credit link<input id="community-avatar-upload-source" type="url" maxlength="500" inputmode="url" placeholder="https://… (optional)" /></label>
          <label class="community-avatar-confirm"><input id="community-avatar-upload-rights" type="checkbox" /> I created this character or have permission to publish and share it.</label>
          <label class="community-avatar-confirm"><input id="community-avatar-upload-rules" type="checkbox" /> This upload follows the community rules: no sexual, exploitative, hateful, harassing, graphic, illegal, privacy-invasive, or stolen content.</label>
          <p id="community-avatar-upload-status" role="status"></p>
        </div>
        <footer><button id="community-avatar-upload-submit" type="button">Validate &amp; publish</button><button value="cancel">Cancel</button></footer>
      </form>
    </dialog>
    <dialog id="community-avatar-report-dialog" class="classic-dialog community-avatar-report-dialog" aria-labelledby="community-avatar-report-title">
      <form method="dialog">
        <header><strong id="community-avatar-report-title">Report Community Avatar</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body community-avatar-form">
          <p id="community-avatar-report-name"></p>
          <label>Reason<select id="community-avatar-report-reason">
            <option value="">Choose a reason…</option>
            <option value="sexual">Nudity or sexual content</option>
            <option value="real-person">Real person, privacy, or impersonation</option>
            <option value="hate">Hateful or racist content</option>
            <option value="harassment">Harassment or targeted abuse</option>
            <option value="violence">Graphic violence or illegal content</option>
            <option value="copyright">Stolen work or copyright concern</option>
            <option value="spam">Spam or misleading listing</option>
            <option value="other">Something else</option>
          </select></label>
          <label>Details<textarea id="community-avatar-report-details" maxlength="500" rows="4" placeholder="Briefly explain the problem (optional)"></textarea></label>
          <p id="community-avatar-report-status" role="status"></p>
        </div>
        <footer><button id="community-avatar-report-submit" type="button">Send report</button><button value="cancel">Cancel</button></footer>
      </form>
    </dialog>
    <dialog id="generator-dialog" class="classic-dialog generator-dialog" aria-labelledby="generator-title">
      <form method="dialog">
        <header><strong id="generator-title">Comic Generator</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body generator-body">
          <p class="generator-private"><strong>Unlisted tool:</strong> nothing on the site links here, and the page asks search engines not to index it. Anyone who knows the address can open it. Scripts stay in this browser and are never posted to IRC.</p>
          <section>
            <strong>1. Give your AI assistant the instructions</strong>
            <p>They list every character, pose, background and limit this site supports, with an example. Paste them into ChatGPT, then describe the comic you want.</p>
            <div class="generator-actions"><button id="generator-copy-brief" type="button">Copy instructions for ChatGPT</button></div>
            <details><summary>Show the instructions</summary><pre id="generator-brief"></pre></details>
          </section>
          <section>
            <label for="generator-script"><strong>2. Paste its reply</strong> (the whole reply is fine; the JSON is found automatically)</label>
            <textarea id="generator-script" rows="12" spellcheck="false" autocomplete="off" placeholder='{"format": "webcomicchat-generation", "cast": {...}, "panels": [...]}'></textarea>
            <div class="generator-actions"><button id="generator-make" type="button" class="generator-primary">Make comic</button><button id="generator-example" type="button">Load the example</button><button id="generator-clear" type="button">Clear</button></div>
          </section>
          <section id="generator-problems" hidden>
            <strong id="generator-problems-title">Fix these, then try again</strong>
            <ul id="generator-errors"></ul>
            <ul id="generator-warnings" class="generator-warnings"></ul>
            <div class="generator-actions"><button id="generator-copy-errors" type="button">Copy for ChatGPT</button></div>
          </section>
        </div>
        <footer><span>The comic opens in the Studio, where you can edit it, save the project, or export a PNG.</span><button value="cancel">Close</button></footer>
      </form>
    </dialog>
    <dialog id="close-dialog" class="classic-dialog close-dialog" aria-labelledby="close-title">
      <form method="dialog">
        <header><strong id="close-title">WebComicChat</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body close-dialog-body"><span aria-hidden="true">?</span><p>Are you sure you want to leave the comic?</p></div>
        <footer><button id="close-yes" value="yes">Yes</button><button id="close-no" value="cancel" autofocus>No</button></footer>
      </form>
    </dialog>
    <dialog id="workshop-live-warning-dialog" class="classic-dialog workshop-live-warning-dialog" aria-labelledby="workshop-live-warning-title">
      <form method="dialog">
        <header><strong id="workshop-live-warning-title">Switch to Offline Comic Studio?</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body close-dialog-body">
          <span aria-hidden="true">!</span>
          <div>
            <p><strong>Comic Studio cannot edit a live room transcript.</strong></p>
            <p id="workshop-live-warning-detail">Continuing will disconnect from the room and clear the entire current comic before opening a blank Studio project.</p>
          </div>
        </div>
        <footer><button value="continue">Disconnect &amp; open blank Studio</button><button value="cancel" autofocus>Stay in room</button></footer>
      </form>
    </dialog>
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
    <dialog id="strip-workshop-dialog" class="classic-dialog strip-workshop-dialog" aria-labelledby="strip-workshop-title">
      <form method="dialog">
        <header><strong id="strip-workshop-title">Offline Comic Studio</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body workshop-body">
          <div class="workshop-intro">
            <div>
              <strong>Direct the comic one beat at a time.</strong>
              <p>Build a cast, direct expressions and gestures, rewrite dialogue, move beats, or mark where a new panel begins. The Comic Chat engine composes the finished shots.</p>
            </div>
            <output id="workshop-summary">0 lines</output>
          </div>
          <div class="workshop-title-editor">
            <label for="workshop-comic-title">Opening title</label>
            <input id="workshop-comic-title" maxlength="80" placeholder="Automatic Comic Chat title" />
            <button id="workshop-apply-title" type="button">Apply title</button>
          </div>
          <div class="workshop-project-tools">
            <div class="workshop-project-description"><strong>Editable project</strong><span>Download a project, or recover the latest compatible Studio edit kept in this browser.</span></div>
            <div class="workshop-scene-tools"><label>Scene<select id="workshop-background">${backdrops.map(({ file, label }) => `<option value="${file}">${label}</option>`).join("")}</select></label><button id="workshop-import-backdrop" type="button">Import scene…</button></div>
            <label>Font<select id="workshop-font">${comicFontOptionsMarkup}</select></label>
            <div class="workshop-project-actions"><button id="workshop-new-project" type="button">New blank</button><button id="workshop-recover-project" type="button" disabled>Recover draft</button><button id="workshop-open-project" type="button">Open project…</button><button id="workshop-save-project" type="button">Save project</button></div>
            <input id="workshop-project-file" class="visually-hidden" type="file" accept=".json,.wcc.json,application/json" />
            <input id="workshop-backdrop-file" class="visually-hidden" type="file" accept=".bgb,application/octet-stream,image/png,image/jpeg,image/webp" />
          </div>
          <details class="workshop-help">
            <summary>How to build an offline comic</summary>
            <ol>
              <li>Each beat adds one character appearance. Reuse a character or choose another to build the cast.</li>
              <li>Choose <strong>Automatic</strong> to let words and emoticons choose the pose, or select an exact expression or gesture. The preview shows the resulting character art before you add it.</li>
              <li>Choose exactly where the new beat belongs: <strong>new panel</strong>, <strong>current panel</strong>, or <strong>automatic</strong> original Comic Chat placement.</li>
              <li>Use <strong>Add speaking character</strong> for dialogue, <strong>Add silent character</strong> for a posed character without a balloon, or <strong>Add empty panel</strong> for a backdrop-only pacing shot.</li>
              <li>Edit, recast, or pose an existing beat below, then choose its highlighted <strong>Apply changes</strong> button. Reorder, duplicate, and remove are immediate.</li>
              <li><strong>Undo edit</strong> and <strong>Redo</strong> cover the current Studio session.</li>
              <li>Use <strong>Import scene…</strong> for a local .bgb, PNG, JPEG, or WebP background. It appears in PNG exports; switch to a built-in scene before saving an editable project.</li>
              <li>Use <strong>Save project</strong> to download an editable copy. <strong>Recover draft</strong> restores the latest compatible edit saved only in this browser.</li>
              <li>Use <strong>Export PNG</strong> to save the finished comic without leaving Studio.</li>
            </ol>
            <p>Studio changes stay in this browser and are never sent to IRC. Comic Chat may start a new panel automatically when a character speaks twice or a shot becomes full. Press Ctrl/⌘+S to save the editable project; outside a text field, Ctrl/⌘+Z and Ctrl/⌘+Shift+Z undo and redo.</p>
          </details>
          <section class="workshop-add" aria-labelledby="workshop-add-title">
            <header><strong id="workshop-add-title">Add a character beat</strong><span>One click adds one character appearance. Choose its panel below.</span></header>
            <div class="workshop-add-fields">
              <label>Character<select id="workshop-add-character"></select></label>
              <label>Display name<input id="workshop-add-name" maxlength="32" placeholder="Character name" /></label>
              <label>Pose<select id="workshop-add-pose"></select></label>
              <label>Balloon<select id="workshop-add-mode"><option value="say">Say</option><option value="think">Think</option><option value="whisper">Whisper</option><option value="action">Action / narration</option></select></label>
              <figure class="workshop-add-preview">
                <canvas id="workshop-add-pose-preview" width="128" height="128" role="img" aria-label="Preview of the selected character pose"></canvas>
                <figcaption id="workshop-add-pose-caption">Selected pose preview</figcaption>
              </figure>
              <label class="workshop-add-dialogue"><span>Dialogue <output id="workshop-add-count">0 / 180</output></span><textarea id="workshop-add-message" maxlength="180" rows="2" placeholder="Type a line, or use Add silent character without one"></textarea></label>
              <label class="workshop-add-placement">Panel placement<select id="workshop-add-placement"><option value="new">Start a new panel (guaranteed)</option><option value="current">Add to the current panel (if it fits)</option><option value="auto">Automatic Comic Chat placement</option></select></label>
              <div class="workshop-add-actions"><button id="workshop-add-speaking" type="button">Add speaking character to new panel</button><button id="workshop-add-silent" type="button">Add silent character to new panel</button><button id="workshop-add-empty" type="button">Add empty panel</button></div>
            </div>
          </section>
          <section class="workshop-panel-plan" aria-labelledby="workshop-panel-plan-title">
            <header><strong id="workshop-panel-plan-title">What is in each panel</strong><span>The title card is separate.</span></header>
            <div id="workshop-panel-map" class="workshop-panel-map"></div>
          </section>
          <div class="workshop-key" aria-hidden="true"><span>Sequence</span><span>Script &amp; staging</span><span>Line tools</span></div>
          <div id="workshop-lines" class="workshop-lines"></div>
          <p class="workshop-local-note">Workshop edits change only this local comic. They are never sent back to IRC.</p>
        </div>
        <footer><span>Tip: every beat can use a different character and pose.</span><button id="workshop-undo" type="button" disabled>Undo edit</button><button id="workshop-redo" type="button" disabled>Redo</button><button id="workshop-export-comic" type="button">Export PNG</button><button value="cancel">Close</button></footer>
      </form>
    </dialog>
    <dialog id="avatar-builder-dialog" class="classic-dialog avatar-builder-dialog" aria-labelledby="avatar-builder-title">
      <form method="dialog">
        <header><strong id="avatar-builder-title">Create a Comic Chat character</strong><button value="cancel" aria-label="Close">×</button></header>
        <div class="dialog-body">
          <p>Build a character from transparent full-body art. It stays local unless you choose to publish the downloaded .avb later.</p>
          <fieldset class="builder-mode-picker">
            <legend>How much do you want to customize?</legend>
            <label><input type="radio" name="builder-mode" value="quick" checked /><span><strong>Core character</strong><small>One guided pose for every expression and gesture.</small></span></label>
            <label><input type="radio" name="builder-mode" value="advanced" /><span><strong>Expressive character</strong><small>Up to 24 poses, including gestures and variations.</small></span></label>
          </fieldset>
          <div class="builder-fields">
            <label>Name <input id="builder-name" maxlength="60" placeholder="Character name" /></label>
            <label>Art credit <input id="builder-credit" maxlength="240" placeholder="Your name and license (optional)" /></label>
            <label>Style <select id="builder-style"><option value="mono">Classic black &amp; white</option><option value="color">Color</option></select></label>
            <label class="builder-advanced">Outline aura <span><input id="builder-aura" type="range" min="0" max="8" value="3" /><output id="builder-aura-value">3 px</output></span></label>
          </div>
          <fieldset class="builder-construction-picker builder-advanced">
            <legend>How is the artwork assembled?</legend>
            <label><input type="radio" name="builder-construction" value="full" checked /><span><strong>Complete poses</strong><small>Each image contains the whole character.</small></span></label>
            <label><input type="radio" name="builder-construction" value="composite" /><span><strong>Mix faces &amp; bodies</strong><small>Combine expressions and gestures like classic Armando.</small></span></label>
          </fieldset>
          <section class="builder-full-workspace">
            <div class="builder-add-row">
              <button id="builder-add-poses" type="button">Add pose images…</button>
              <input id="builder-files" class="visually-hidden" type="file" accept="image/png,image/webp,image/jpeg" multiple />
              <small id="builder-image-help">Add 14 full-body images in the guided order shown below.</small>
            </div>
            <p class="builder-art-guide"><strong>For the classic look:</strong> use transparent PNGs with the full character visible, consistent scale and foot position, bold black outlines, and simple shading. Original whole-body art is usually about 150–300 px wide and 300–470 px tall.</p>
            <p class="builder-art-guide builder-advanced"><strong>Emotion and intensity:</strong> assign what each pose conveys. Intensity tells Comic Chat how strongly it conveys it, so a slight smile might be <em>Happy · subtle</em> while a huge grin is <em>Happy · strong</em>. Multiple poses may share an emotion at different strengths; Neutral poses rotate. Keep Neutral at 0%.</p>
            <div id="builder-pose-list" class="builder-pose-list"></div>
          </section>
          <section class="builder-composite-workspace builder-advanced" hidden>
            <p class="builder-art-guide"><strong>Classic composite character:</strong> upload transparent head/face art and headless body/gesture art separately. Click the neck join on every thumbnail, then check combinations in the preview. Comic Chat chooses the face and body independently.</p>
            <div class="builder-part-actions">
              <button id="builder-add-faces" type="button">Add face images…</button>
              <input id="builder-face-files" class="visually-hidden" type="file" accept="image/png,image/webp,image/jpeg" multiple />
              <button id="builder-add-torsos" type="button">Add body images…</button>
              <input id="builder-torso-files" class="visually-hidden" type="file" accept="image/png,image/webp,image/jpeg" multiple />
              <small>Up to 20 faces and 20 bodies. Click each image at the base/top of the neck.</small>
            </div>
            <div class="builder-composite-grid">
              <figure class="builder-composite-preview"><canvas id="builder-composite-preview" width="260" height="260" role="img" aria-label="Preview of selected face and body"></canvas><figcaption id="builder-composite-caption">Add a face and body to preview combinations.</figcaption></figure>
              <section><h3>Faces &amp; expressions</h3><div id="builder-face-list" class="builder-part-list"></div></section>
              <section><h3>Bodies &amp; gestures</h3><div id="builder-torso-list" class="builder-part-list"></div></section>
            </div>
          </section>
          <p id="builder-status" class="builder-status" role="status">Add at least one neutral pose.</p>
        </div>
        <footer><button id="builder-clear" type="button">Clear poses</button><button value="cancel">Cancel</button><button id="builder-download" type="button" disabled>Build, use &amp; download</button></footer>
      </form>
    </dialog>
  </div>
  <button id="comic-taskbar-button" class="comic-taskbar-button" type="button" hidden><img class="classic-app-icon" src="${classicAppIconUrl}" alt="" />WebComicChat</button>
  <div id="shutdown-screen" class="shutdown-screen" role="button" tabindex="0" aria-label="Restore Comic Chat" hidden>
    <p>It's now safe to turn off your comic.</p><small>Click anywhere to come back.</small>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element: ${selector}`);
  return value;
}

const characterSelect = element<HTMLSelectElement>("#character");
const backdropSelect = element<HTMLSelectElement>("#backdrop");
const importBackdropButton = element<HTMLButtonElement>("#import-backdrop");
const backdropFileInput = element<HTMLInputElement>("#backdrop-file");
const messageInput = element<HTMLTextAreaElement>("#message");
const messageMode = element<HTMLSelectElement>("#message-mode");
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>(".mode-button")];
const countLabel = element<HTMLElement>("#count");
const toneValue = element<HTMLElement>("#tone-value");
const toneReason = element<HTMLElement>("#tone-reason");
const workspace = element<HTMLElement>("#workspace");
const strip = element<HTMLElement>("#strip");
const stage = element<HTMLElement>(".stage-wrap");
const stripCount = element<HTMLElement>("#strip-count");
const panelSelectionBar = element<HTMLElement>("#panel-selection-bar");
const panelSelectionCount = element<HTMLElement>("#panel-selection-count");
const selectAllPanelsButton = element<HTMLButtonElement>("#select-all-panels");
const clearPanelSelectionButton = element<HTMLButtonElement>("#clear-panel-selection");
const saveSelectedPanelsButton = element<HTMLButtonElement>("#save-selected-panels");
const finishPanelSelectionButton = element<HTMLButtonElement>("#finish-panel-selection");
const panelsAcrossSelect = element<HTMLSelectElement>("#panels-across");
const balloonFontSelect = element<HTMLSelectElement>("#balloon-font");
const panelSizeInput = element<HTMLInputElement>("#panel-size");
const panelSizeValue = element<HTMLOutputElement>("#panel-size-value");
const status = element<HTMLElement>("#status");
const addButton = element<HTMLButtonElement>("#add-panel");
const undoButton = element<HTMLButtonElement>("#undo-panel");
const clearButton = element<HTMLButtonElement>("#clear-strip");
const selectPanelsButton = element<HTMLButtonElement>("#select-panels");
const downloadButton = element<HTMLButtonElement>("#download");
const classicWindow = element<HTMLElement>("#classic-window");
const classicTitlebar = element<HTMLElement>("#classic-titlebar");
const systemMenuButton = element<HTMLButtonElement>("#system-menu-button");
const systemMenu = element<HTMLElement>("#system-menu");
const windowMinimizeButton = element<HTMLButtonElement>("#window-minimize");
const windowMaximizeButton = element<HTMLButtonElement>("#window-maximize");
const windowCloseButton = element<HTMLButtonElement>("#window-close");
const comicTaskbarButton = element<HTMLButtonElement>("#comic-taskbar-button");
const shutdownScreen = element<HTMLElement>("#shutdown-screen");
const classicMenu = element<HTMLElement>("#classic-menu");
const classicMenuSections = [...classicMenu.querySelectorAll<HTMLDetailsElement>("details")];
const menuCommandButtons = [...classicMenu.querySelectorAll<HTMLButtonElement>("button[data-command]")];
const aboutDialog = element<HTMLDialogElement>("#about-dialog");
const botTipsDialog = element<HTMLDialogElement>("#bot-tips-dialog");
const botTipsPresence = element<HTMLElement>("#bot-tips-presence");
const notificationDialog = element<HTMLDialogElement>("#notification-dialog");
const notificationSound = element<HTMLInputElement>("#notification-sound");
const notificationWatch = element<HTMLTextAreaElement>("#notification-watch");
const notificationSleepStatus = element<HTMLOutputElement>("#notification-sleep-status");
const notificationPermission = element<HTMLElement>("#notification-permission");
const notificationSave = element<HTMLButtonElement>("#notification-save");
const notificationSleepHour = element<HTMLButtonElement>("#notification-sleep-hour");
const notificationSleepEight = element<HTMLButtonElement>("#notification-sleep-eight");
const notificationResume = element<HTMLButtonElement>("#notification-resume");
const chatCommandsDialog = element<HTMLDialogElement>("#chat-commands-dialog");
const roomBookmarksDialog = element<HTMLDialogElement>("#room-bookmarks-dialog");
const roomBookmarkMenuList = element<HTMLElement>("#room-bookmark-menu-list");
const roomBookmarkDialogList = element<HTMLElement>("#room-bookmark-dialog-list");
const communityAvatarsDialog = element<HTMLDialogElement>("#community-avatars-dialog");
const communityAvatarList = element<HTMLElement>("#community-avatar-list");
const communityAvatarCatalogStatus = element<HTMLElement>("#community-avatar-catalog-status");
const communityAvatarUploadOpen = element<HTMLButtonElement>("#community-avatar-upload-open");
const communityAvatarUploadDialog = element<HTMLDialogElement>("#community-avatar-upload-dialog");
const communityAvatarUploadFile = element<HTMLInputElement>("#community-avatar-upload-file");
const communityAvatarUploadName = element<HTMLInputElement>("#community-avatar-upload-name");
const communityAvatarUploadCreator = element<HTMLInputElement>("#community-avatar-upload-creator");
const communityAvatarUploadDescription = element<HTMLTextAreaElement>("#community-avatar-upload-description");
const communityAvatarUploadSource = element<HTMLInputElement>("#community-avatar-upload-source");
const communityAvatarUploadRights = element<HTMLInputElement>("#community-avatar-upload-rights");
const communityAvatarUploadRules = element<HTMLInputElement>("#community-avatar-upload-rules");
const communityAvatarUploadStatus = element<HTMLElement>("#community-avatar-upload-status");
const communityAvatarUploadSubmit = element<HTMLButtonElement>("#community-avatar-upload-submit");
const communityAvatarReportDialog = element<HTMLDialogElement>("#community-avatar-report-dialog");
const communityAvatarReportName = element<HTMLElement>("#community-avatar-report-name");
const communityAvatarReportReason = element<HTMLSelectElement>("#community-avatar-report-reason");
const communityAvatarReportDetails = element<HTMLTextAreaElement>("#community-avatar-report-details");
const communityAvatarReportStatus = element<HTMLElement>("#community-avatar-report-status");
const communityAvatarReportSubmit = element<HTMLButtonElement>("#community-avatar-report-submit");
const closeDialog = element<HTMLDialogElement>("#close-dialog");
const generatorDialog = element<HTMLDialogElement>("#generator-dialog");
const generatorBrief = element<HTMLPreElement>("#generator-brief");
const generatorScript = element<HTMLTextAreaElement>("#generator-script");
const generatorProblems = element<HTMLElement>("#generator-problems");
const generatorProblemsTitle = element<HTMLElement>("#generator-problems-title");
const generatorErrors = element<HTMLUListElement>("#generator-errors");
const generatorWarnings = element<HTMLUListElement>("#generator-warnings");
const workshopLiveWarningDialog = element<HTMLDialogElement>("#workshop-live-warning-dialog");
const workshopLiveWarningDetail = element<HTMLElement>("#workshop-live-warning-detail");
const textView = element<HTMLOListElement>("#text-view");
const chatAnnouncer = element<HTMLDivElement>("#chat-announcer");
const PLAIN_TEXT_KEY = "webcomicchat.plainText";
let plainTextView = (() => { try { return window.localStorage.getItem(PLAIN_TEXT_KEY) === "1"; } catch { return false; } })();
const liveConsole = element<HTMLElement>("#live-console");
const liveStatus = element<HTMLElement>("#live-status");
const connectionGuidance = element<HTMLElement>("#connection-guidance");
const networkSelect = element<HTMLSelectElement>("#network");
const nicknameInput = element<HTMLInputElement>("#nickname");
const channelInput = element<HTMLInputElement>("#channel");
const connectButton = element<HTMLButtonElement>("#connect-live");
const browseRoomsButton = element<HTMLButtonElement>("#browse-rooms");
const shareRoomButton = element<HTMLButtonElement>("#share-room");
const disconnectButton = element<HTMLButtonElement>("#disconnect-live");
const liberaWebChatLink = element<HTMLAnchorElement>("#libera-web-chat");
const addLabel = element<HTMLElement>("#add-label");
const roomBrowser = element<HTMLElement>("#room-browser");
const closeRoomBrowserButton = element<HTMLButtonElement>("#close-room-browser");
const roomList = element<HTMLElement>("#room-list");
const roomFilter = element<HTMLInputElement>("#room-filter");
const roomSummary = element<HTMLElement>("#room-summary");
const refreshRoomsButton = element<HTMLButtonElement>("#refresh-rooms");
const memberList = element<HTMLElement>("#member-list");
const memberTargetSummary = element<HTMLElement>("#member-target-summary");
const memberPane = element<HTMLElement>("#member-pane");
const memberPaneContent = element<HTMLElement>("#member-pane-content");
const memberPaneToggle = element<HTMLButtonElement>("#member-pane-toggle");
const avatarRulesButton = element<HTMLButtonElement>("#avatar-rules-button");
const avatarRulesDialog = element<HTMLDialogElement>("#avatar-rules-dialog");
const officialAvatarsOnly = element<HTMLInputElement>("#official-avatars-only");
const avatarArtPreferenceInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="avatar-art-preference"]')];
const avatarRuleList = element<HTMLElement>("#avatar-rule-list");
const resetAvatarRulesButton = element<HTMLButtonElement>("#reset-avatar-rules");
const openStripWorkshopButton = element<HTMLButtonElement>("#open-strip-workshop");
const stripWorkshopDialog = element<HTMLDialogElement>("#strip-workshop-dialog");
const workshopSummary = element<HTMLOutputElement>("#workshop-summary");
const workshopComicTitle = element<HTMLInputElement>("#workshop-comic-title");
const workshopApplyTitleButton = element<HTMLButtonElement>("#workshop-apply-title");
const workshopNewProjectButton = element<HTMLButtonElement>("#workshop-new-project");
const workshopRecoverProjectButton = element<HTMLButtonElement>("#workshop-recover-project");
const workshopOpenProjectButton = element<HTMLButtonElement>("#workshop-open-project");
const workshopSaveProjectButton = element<HTMLButtonElement>("#workshop-save-project");
const workshopProjectFile = element<HTMLInputElement>("#workshop-project-file");
const workshopBackground = element<HTMLSelectElement>("#workshop-background");
const workshopImportBackdropButton = element<HTMLButtonElement>("#workshop-import-backdrop");
const workshopBackdropFileInput = element<HTMLInputElement>("#workshop-backdrop-file");
const workshopFont = element<HTMLSelectElement>("#workshop-font");
const workshopAddCharacter = element<HTMLSelectElement>("#workshop-add-character");
const workshopAddName = element<HTMLInputElement>("#workshop-add-name");
const workshopAddPose = element<HTMLSelectElement>("#workshop-add-pose");
const workshopAddPosePreview = element<HTMLCanvasElement>("#workshop-add-pose-preview");
const workshopAddPoseCaption = element<HTMLElement>("#workshop-add-pose-caption");
const workshopAddMode = element<HTMLSelectElement>("#workshop-add-mode");
const workshopAddMessage = element<HTMLTextAreaElement>("#workshop-add-message");
const workshopAddCount = element<HTMLOutputElement>("#workshop-add-count");
const workshopAddPlacement = element<HTMLSelectElement>("#workshop-add-placement");
const workshopAddSpeakingButton = element<HTMLButtonElement>("#workshop-add-speaking");
const workshopAddSilentButton = element<HTMLButtonElement>("#workshop-add-silent");
const workshopAddEmptyButton = element<HTMLButtonElement>("#workshop-add-empty");
const workshopPanelMap = element<HTMLElement>("#workshop-panel-map");
const workshopLines = element<HTMLElement>("#workshop-lines");
const workshopUndoButton = element<HTMLButtonElement>("#workshop-undo");
const workshopRedoButton = element<HTMLButtonElement>("#workshop-redo");
const workshopExportComicButton = element<HTMLButtonElement>("#workshop-export-comic");
const roomTabLabel = element<HTMLElement>("#room-tab-label");
const windowRoom = element<HTMLElement>("#window-room");
const characterPane = element<HTMLElement>("#character-pane");
const characterPaneContent = element<HTMLElement>("#character-pane-content");
const characterPaneToggle = element<HTMLButtonElement>("#character-pane-toggle");
const characterPreview = element<HTMLCanvasElement>("#character-preview");
const characterPaneSizeButton = element<HTMLButtonElement>("#character-pane-size");
const emotionWheelHost = element<HTMLElement>("#emotion-wheel");
const communityAvatarsButton = element<HTMLButtonElement>("#community-avatars");
const importAvatarButton = element<HTMLButtonElement>("#import-avatar");
const avatarFileInput = element<HTMLInputElement>("#avatar-file");
const createAvatarButton = element<HTMLButtonElement>("#create-avatar");
const avatarBuilderDialog = element<HTMLDialogElement>("#avatar-builder-dialog");
const builderModeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="builder-mode"]')];
const builderConstructionInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="builder-construction"]')];
const builderNameInput = element<HTMLInputElement>("#builder-name");
const builderCreditInput = element<HTMLInputElement>("#builder-credit");
const builderStyleSelect = element<HTMLSelectElement>("#builder-style");
const builderAuraInput = element<HTMLInputElement>("#builder-aura");
const builderAuraValue = element<HTMLOutputElement>("#builder-aura-value");
const builderAddPosesButton = element<HTMLButtonElement>("#builder-add-poses");
const builderFilesInput = element<HTMLInputElement>("#builder-files");
const builderImageHelp = element<HTMLElement>("#builder-image-help");
const builderPoseList = element<HTMLElement>("#builder-pose-list");
const builderFullWorkspace = element<HTMLElement>(".builder-full-workspace");
const builderCompositeWorkspace = element<HTMLElement>(".builder-composite-workspace");
const builderAddFacesButton = element<HTMLButtonElement>("#builder-add-faces");
const builderFaceFilesInput = element<HTMLInputElement>("#builder-face-files");
const builderAddTorsosButton = element<HTMLButtonElement>("#builder-add-torsos");
const builderTorsoFilesInput = element<HTMLInputElement>("#builder-torso-files");
const builderFaceList = element<HTMLElement>("#builder-face-list");
const builderTorsoList = element<HTMLElement>("#builder-torso-list");
const builderCompositePreview = element<HTMLCanvasElement>("#builder-composite-preview");
const builderCompositeCaption = element<HTMLElement>("#builder-composite-caption");
const builderStatus = element<HTMLElement>("#builder-status");
const builderClearButton = element<HTMLButtonElement>("#builder-clear");
const builderDownloadButton = element<HTMLButtonElement>("#builder-download");

const avatarCache = new Map<string, Promise<LoadedAvatar>>();
const communityAvatarLoads = new Map<string, Promise<LoadedAvatar>>();
const communityAvatarByFile = new Map<string, HostedCommunityAvatar>();
const communityAvatarByAnnouncement = new Map<string, HostedCommunityAvatar>();
function indexCommunityAvatars(): void {
  communityAvatarByFile.clear();
  communityAvatarByAnnouncement.clear();
  for (const entry of communityAvatars) {
    communityAvatarByFile.set(entry.fileUrl, entry);
    communityAvatarByFile.set(new URL(entry.fileUrl, window.location.href).href, entry);
    communityAvatarByAnnouncement.set(entry.announcementName.toLocaleLowerCase(), entry);
  }
}
indexCommunityAvatars();
const sessionCustomBackdrops = new Map<string, { name: string; bitmap: DecodedBitmap }>();
const acceptedHostedAvatars = new Set<string>();
const sessionCustomAvatars = new Set<string>();
const conversation: ConversationLine[] = [];
const frozenPoses = new Map<string, PoseChoice>();
let panelCanvases: HTMLCanvasElement[] = [];
let panelKeys: string[] = [];
let selectedPanelKeys = new Set<string>();
let panelSelectionMode = false;
let backdropBitmap: DecodedBitmap;
let backdropCanvas: HTMLCanvasElement;
let backdropGeneration = 0;
let renderGeneration = 0;
let memberGeneration = 0;
let avatarRemapGeneration = 0;
let previewGeneration = 0;
let isAdding = false;
let liveState: LiveState = "offline";
let joinedChannel = "";
let joinedNickname = "";
const notificationStorage = (() => { try { return window.localStorage; } catch { return undefined; } })();
const notifyPolicy = new NotifyPolicy(loadNotifySettings(notificationStorage));
const tabAttention = new TabAttention();
let pendingNotifySleepUntil = notifyPolicy.settings.sleepUntil;
let roomBookmarks: RoomSelection[] = parseRoomBookmarks(null);
let roomDirectoryLoaded = false;
let panelsAcross: PanelsAcross = "auto";
let comicFontId: ComicFontId = "comic-sans-ms";
let hiddenComicBots = new Set<string>();
let censorContent = false;
let comicTitleOverride = "";
let workshopPanelSummaries: WorkshopPanelSummary[] = [];
const studioUndoHistory: StudioSnapshot[] = [];
const studioRedoHistory: StudioSnapshot[] = [];
let activeWorkshopDraftRow: HTMLElement | undefined;
let workshopPosePreviewGeneration = 0;
let workshopPosePreviewTimer: ReturnType<typeof setTimeout> | undefined;
let studioAutosaveQueued = false;
let liveComicGeneration = 0;
let remoteQueue = Promise.resolve();
const pendingLiveLines: PendingLiveLine[] = [];
const publicRooms = new Map<string, LiveRoomEvent>();
const knownMembers = new Set<string>();
const selectedAddressees = new Set<string>();
const announcedAvatars = new Map<string, AvatarAnnouncement>();
let avatarDisplayPolicy: AvatarDisplayPolicy = { officialOnly: true, artPreference: "none", forced: {} };
let totalPublicRooms = 0;
let currentWheelEmotion: WheelEmotion = { emotion: 0, intensity: 0 };
let suppressWheelChange = false;
let importedAvatarSequence = 0;
let importedBackdropSequence = 0;
const builderPoses: Array<CreatorPose & { filename: string }> = [];
type BuilderPartPose = CreatorPartPose & { filename: string };
const builderFaces: BuilderPartPose[] = [];
const builderTorsos: BuilderPartPose[] = [];
let selectedBuilderFace = 0;
let selectedBuilderTorso = 0;
const QUICK_BUILDER_EMOTIONS = BUILDER_EMOTIONS.map(([emotion]) => emotion);
const BUILDER_EMOTION_NAMES = new Map<number, string>(BUILDER_EMOTIONS);
let builderBusy = false;
let forceNextPanel = false;
let minimizeSurpriseShown = false;
let closeReliefShown = false;
let helpEggShown = false;
let lastPokeRageAt = 0;
let titlebarClickTimes: number[] = [];
let localComicQueue = Promise.resolve();
const comicFontsReady = loadComicFonts(document.fonts);

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

function setCharacterPaneLarge(large: boolean, persist = true, redraw = true): void {
  workspace.classList.toggle("character-pane-large", large);
  characterPaneSizeButton.setAttribute("aria-pressed", String(large));
  characterPaneSizeButton.textContent = large ? "Normal size" : "Enlarge";
  characterPreview.width = large ? 300 : 200;
  characterPreview.height = large ? 164 : 108;
  emotionWheel.resize(large ? 180 : 132);
  if (persist) {
    try {
      localStorage.setItem("comic-chat-character-pane-large", large ? "1" : "0");
    } catch {}
  }
  updatePanelView();
  if (redraw) void updateCharacterPreview().catch(showError);
}

function setSidebarPaneCollapsed(
  pane: HTMLElement,
  content: HTMLElement,
  toggle: HTMLButtonElement,
  collapsed: boolean,
  storageKey: string,
  label: string,
  persist = true,
): void {
  pane.classList.toggle("pane-collapsed", collapsed);
  content.hidden = collapsed;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label}`);
  const disclosure = toggle.querySelector<HTMLElement>("span");
  if (disclosure) disclosure.textContent = collapsed ? "▶" : "▼";
  if (persist) {
    try {
      localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {}
  }
}

characterPaneSizeButton.addEventListener("click", () => {
  setCharacterPaneLarge(!workspace.classList.contains("character-pane-large"));
});
characterPaneToggle.addEventListener("click", () => {
  setSidebarPaneCollapsed(
    characterPane,
    characterPaneContent,
    characterPaneToggle,
    !characterPane.classList.contains("pane-collapsed"),
    "comic-chat-character-pane-collapsed",
    "your character",
  );
});
memberPaneToggle.addEventListener("click", () => {
  setSidebarPaneCollapsed(
    memberPane,
    memberPaneContent,
    memberPaneToggle,
    !memberPane.classList.contains("pane-collapsed"),
    "comic-chat-member-pane-collapsed",
    "members",
  );
});

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

function importedBackgroundName(filename: string): string {
  const stem = filename.replace(/\.(?:bgb|png|jpe?g|webp)$/iu, "").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return stem.slice(0, 60) || "Imported background";
}

async function decodeBackgroundImage(file: File): Promise<DecodedBitmap> {
  if (file.size > 4 * 1024 * 1024) throw new Error("Background images must be 4 MB or smaller");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 2048 || bitmap.height > 2048
      || bitmap.width * bitmap.height > 4 * 1024 * 1024) {
      throw new Error("Background images must be 2048×2048 pixels or smaller");
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas image decoding is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { width: bitmap.width, height: bitmap.height, pixels: new Uint8ClampedArray(pixels) };
  } finally {
    bitmap.close();
  }
}

async function importLocalBackdrop(file: File): Promise<void> {
  if (sessionCustomBackdrops.size >= MAX_SESSION_CUSTOM_BACKDROPS) {
    throw new Error(`This tab already has the maximum of ${MAX_SESSION_CUSTOM_BACKDROPS} custom backgrounds`);
  }
  const lowerName = file.name.toLocaleLowerCase();
  const isBgb = lowerName.endsWith(".bgb");
  const isImage = /\.(?:png|jpe?g|webp)$/iu.test(lowerName)
    || ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  if (!isBgb && !isImage) throw new Error("Choose a .bgb, PNG, JPEG, or WebP background");
  setStatus(`Checking ${file.name}…`);
  const imported = isBgb
    ? await validateBackdropImport(await file.arrayBuffer(), file.name)
    : { name: importedBackgroundName(file.name), bitmap: await decodeBackgroundImage(file) };
  const key = `local-backdrop:${++importedBackdropSequence}`;
  sessionCustomBackdrops.set(key, imported);
  const label = `${imported.name} — imported`;
  backdropSelect.append(new Option(label, key));
  workshopBackground.append(new Option(label, key));
  if (stripWorkshopDialog.open) recordStudioEdit();
  backdropSelect.value = key;
  workshopBackground.value = key;
  await loadBackdrop();
  if (stripWorkshopDialog.open) renderStripWorkshop();
  setStatus(`${imported.name} is now the background. It stays in this tab and will appear in saved comic PNGs.`);
}

function setBuilderStatus(message: string, error = false): void {
  builderStatus.textContent = message;
  builderStatus.classList.toggle("error", error);
}

function builderMode(): "quick" | "advanced" {
  return builderModeInputs.find((input) => input.checked)?.value === "advanced" ? "advanced" : "quick";
}

function builderConstruction(): "full" | "composite" {
  return builderConstructionInputs.find((input) => input.checked)?.value === "composite" ? "composite" : "full";
}

function compositeBuilderActive(): boolean {
  return builderMode() === "advanced" && builderConstruction() === "composite";
}

function quickBuilderStatus(): string {
  const missing = QUICK_BUILDER_EMOTIONS.find((emotion) => !builderPoses.some((pose) => pose.emotion === emotion));
  if (missing === undefined) return "All 14 core poses are ready. Add a name, then build your character.";
  return `${builderPoses.length} / 14 core poses ready. Next: ${BUILDER_EMOTION_NAMES.get(missing) ?? "pose"}.`;
}

function compositeBuilderStatus(): string {
  if (builderFaces.length === 0 && builderTorsos.length === 0) return "Add at least one face and one body image.";
  if (builderFaces.length === 0) return `${builderTorsos.length} ${builderTorsos.length === 1 ? "body" : "bodies"} ready. Add a face image.`;
  if (builderTorsos.length === 0) return `${builderFaces.length} ${builderFaces.length === 1 ? "face" : "faces"} ready. Add a body image.`;
  const faceLabel = builderFaces.length === 1 ? "face" : "faces";
  const bodyLabel = builderTorsos.length === 1 ? "body" : "bodies";
  return `${builderFaces.length} ${faceLabel} × ${builderTorsos.length} ${bodyLabel} = ${builderFaces.length * builderTorsos.length} possible combinations. Click any thumbnail to adjust its neck join.`;
}

function applyBuilderConstruction(): void {
  const composite = compositeBuilderActive();
  avatarBuilderDialog.dataset.construction = composite ? "composite" : "full";
  builderFullWorkspace.hidden = composite;
  builderCompositeWorkspace.hidden = !composite;
  if (composite) {
    renderBuilderParts();
    setBuilderStatus(compositeBuilderStatus());
  } else {
    renderBuilderPoses();
    setBuilderStatus(builderMode() === "quick" ? quickBuilderStatus()
      : builderPoses.length ? `${builderPoses.length} pose images ready. Assign the matching emotion to each.` : "Add at least one neutral pose.");
  }
  updateBuilderControls();
}

function applyBuilderMode(): void {
  const mode = builderMode();
  if (mode === "quick" && builderPoses.length > QUICK_BUILDER_EMOTIONS.length) {
    const advanced = builderModeInputs.find((input) => input.value === "advanced");
    if (advanced) advanced.checked = true;
    avatarBuilderDialog.dataset.mode = "advanced";
    setBuilderStatus("Core character uses 14 poses. Remove extras before switching from Expressive character.", true);
    return;
  }
  avatarBuilderDialog.dataset.mode = mode;
  builderFilesInput.multiple = true;
  builderAddPosesButton.textContent = mode === "advanced" ? "Add pose images…" : "Add core pose images…";
  builderImageHelp.textContent = mode === "advanced"
    ? "Add up to 24 full-body poses, including repeated expressions and gestures. Source art up to 2048 px is reduced to fit 512 px."
    : "Add one pose for each slot: Neutral, Happy, Coy, Bored, Scared, Sad, Angry, Shout, Laugh, Wave, Point at other, Point at self, Double point, and Shrug. Number filenames 01–14 if selecting them together.";
  if (mode === "quick") {
    builderPoses.forEach((pose, index) => {
      pose.emotion = QUICK_BUILDER_EMOTIONS[index];
      pose.intensity = pose.emotion === 9 ? 0 : 0.8;
    });
  }
  applyBuilderConstruction();
}

function updateBuilderControls(): void {
  builderAuraValue.value = `${builderAuraInput.value} px`;
  builderAddPosesButton.disabled = builderBusy;
  builderAddFacesButton.disabled = builderBusy;
  builderAddTorsosButton.disabled = builderBusy;
  const composite = compositeBuilderActive();
  const posesReady = composite
    ? builderFaces.length > 0 && builderTorsos.length > 0
    : builderMode() === "quick" ? builderPoses.length === QUICK_BUILDER_EMOTIONS.length : builderPoses.length > 0;
  builderDownloadButton.disabled = builderBusy || !posesReady || builderNameInput.value.trim().length === 0;
  builderClearButton.disabled = builderBusy || (composite ? builderFaces.length + builderTorsos.length === 0 : builderPoses.length === 0);
  builderClearButton.textContent = composite ? "Clear faces & bodies" : "Clear poses";
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

function builderIntensityLabel(value: number): string {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const description = percent === 0 ? "neutral" : percent <= 33 ? "subtle" : percent <= 66 ? "moderate" : "strong";
  return `${description} (${percent}%)`;
}

function builderArtCanvas(art: CreatorPose["art"]): HTMLCanvasElement {
  const source = document.createElement("canvas");
  source.width = art.width;
  source.height = art.height;
  source.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(art.pixels), art.width, art.height), 0, 0);
  return source;
}

function builderPartDrawing(canvas: HTMLCanvasElement, part: BuilderPartPose): { scale: number; left: number; top: number } {
  const scale = Math.min((canvas.width - 8) / part.art.width, (canvas.height - 8) / part.art.height);
  return {
    scale,
    left: (canvas.width - part.art.width * scale) / 2,
    top: (canvas.height - part.art.height * scale) / 2,
  };
}

function drawBuilderPart(canvas: HTMLCanvasElement, part: BuilderPartPose): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const drawing = builderPartDrawing(canvas, part);
  context.imageSmoothingEnabled = false;
  context.drawImage(builderArtCanvas(part.art), drawing.left, drawing.top, part.art.width * drawing.scale, part.art.height * drawing.scale);
  const x = drawing.left + part.neck.x * drawing.scale;
  const y = drawing.top + part.neck.y * drawing.scale;
  context.strokeStyle = "#d00000";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x - 6, y);
  context.lineTo(x + 6, y);
  context.moveTo(x, y - 6);
  context.lineTo(x, y + 6);
  context.stroke();
  context.fillStyle = "#fff";
  context.fillRect(x - 1, y - 1, 2, 2);
}

function drawBuilderCompositePreview(): void {
  const context = builderCompositePreview.getContext("2d");
  if (!context) return;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, builderCompositePreview.width, builderCompositePreview.height);
  const face = builderFaces[selectedBuilderFace];
  const torso = builderTorsos[selectedBuilderTorso];
  if (!face || !torso) {
    context.fillStyle = "#555";
    context.font = "12px 'MS Sans Serif', sans-serif";
    context.textAlign = "center";
    context.fillText("Add a face and body", builderCompositePreview.width / 2, builderCompositePreview.height / 2);
    builderCompositeCaption.textContent = "Add a face and body to preview combinations.";
    return;
  }
  const faceX = torso.neck.x - face.neck.x;
  const faceY = torso.neck.y - face.neck.y;
  const minX = Math.min(0, faceX);
  const minY = Math.min(0, faceY);
  const maxX = Math.max(torso.art.width, faceX + face.art.width);
  const maxY = Math.max(torso.art.height, faceY + face.art.height);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min((builderCompositePreview.width - 20) / width, (builderCompositePreview.height - 20) / height);
  const left = (builderCompositePreview.width - width * scale) / 2 - minX * scale;
  const top = (builderCompositePreview.height - height * scale) / 2 - minY * scale;
  context.imageSmoothingEnabled = false;
  context.drawImage(builderArtCanvas(torso.art), left, top, torso.art.width * scale, torso.art.height * scale);
  context.drawImage(builderArtCanvas(face.art), left + faceX * scale, top + faceY * scale, face.art.width * scale, face.art.height * scale);
  const joinX = left + torso.neck.x * scale;
  const joinY = top + torso.neck.y * scale;
  context.strokeStyle = "#d00000";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(joinX - 5, joinY);
  context.lineTo(joinX + 5, joinY);
  context.moveTo(joinX, joinY - 5);
  context.lineTo(joinX, joinY + 5);
  context.stroke();
  builderCompositeCaption.textContent = `${face.filename} + ${torso.filename} · red cross is the neck join`;
}

function renderBuilderPartList(parts: BuilderPartPose[], host: HTMLElement, kind: "face" | "torso"): void {
  host.replaceChildren();
  if (parts.length === 0) {
    host.append(Object.assign(document.createElement("p"), { className: "builder-empty", textContent: kind === "face" ? "No face images yet." : "No body images yet." }));
    return;
  }
  const selected = kind === "face" ? selectedBuilderFace : selectedBuilderTorso;
  parts.forEach((part, index) => {
    const row = document.createElement("article");
    row.className = "builder-part-row";
    if (index === selected) row.classList.add("selected");
    const preview = document.createElement("canvas");
    preview.width = 88;
    preview.height = 88;
    preview.tabIndex = 0;
    preview.setAttribute("role", "button");
    preview.setAttribute("aria-label", `Set the neck point for ${part.filename}`);
    preview.title = "Click where this part joins at the neck";
    drawBuilderPart(preview, part);
    preview.addEventListener("click", (event) => {
      const rect = preview.getBoundingClientRect();
      const drawing = builderPartDrawing(preview, part);
      const canvasX = (event.clientX - rect.left) * preview.width / rect.width;
      const canvasY = (event.clientY - rect.top) * preview.height / rect.height;
      part.neck.x = Math.round(Math.max(0, Math.min(part.art.width, (canvasX - drawing.left) / drawing.scale)));
      part.neck.y = Math.round(Math.max(0, Math.min(part.art.height, (canvasY - drawing.top) / drawing.scale)));
      if (kind === "face") selectedBuilderFace = index;
      else selectedBuilderTorso = index;
      renderBuilderParts();
      setBuilderStatus(compositeBuilderStatus());
    });
    const details = document.createElement("div");
    const filename = document.createElement("strong");
    filename.textContent = part.filename;
    filename.title = part.filename;
    const emotion = document.createElement("select");
    emotion.setAttribute("aria-label", `Emotion for ${part.filename}`);
    for (const [value, label] of BUILDER_EMOTIONS) emotion.append(new Option(label, String(value)));
    emotion.value = String(part.emotion);
    const intensity = document.createElement("input");
    intensity.type = "range";
    intensity.min = "0";
    intensity.max = "100";
    intensity.value = String(Math.round(part.intensity * 100));
    const intensityValue = document.createElement("output");
    intensityValue.value = builderIntensityLabel(Number(intensity.value));
    emotion.addEventListener("change", () => {
      part.emotion = Number(emotion.value);
      if (part.emotion === 9) {
        part.intensity = 0;
        intensity.value = "0";
        intensityValue.value = builderIntensityLabel(0);
      }
    });
    intensity.addEventListener("input", () => {
      part.intensity = Number(intensity.value) / 100;
      intensityValue.value = builderIntensityLabel(Number(intensity.value));
    });
    const intensityLabel = document.createElement("label");
    intensityLabel.textContent = "Intensity ";
    intensityLabel.append(intensity, intensityValue);
    const coordinates = document.createElement("div");
    coordinates.className = "builder-neck-coordinates";
    for (const axis of ["x", "y"] as const) {
      const label = document.createElement("label");
      label.textContent = `Neck ${axis.toLocaleUpperCase()} `;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = String(axis === "x" ? part.art.width : part.art.height);
      input.value = String(part.neck[axis]);
      input.addEventListener("change", () => {
        part.neck[axis] = Math.max(0, Math.min(Number(input.max), Number(input.value) || 0));
        if (kind === "face") selectedBuilderFace = index;
        else selectedBuilderTorso = index;
        renderBuilderParts();
      });
      label.append(input);
      coordinates.append(label);
    }
    details.append(filename, emotion, intensityLabel, coordinates);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      parts.splice(index, 1);
      if (kind === "face") selectedBuilderFace = Math.max(0, Math.min(selectedBuilderFace, parts.length - 1));
      else selectedBuilderTorso = Math.max(0, Math.min(selectedBuilderTorso, parts.length - 1));
      renderBuilderParts();
      setBuilderStatus(compositeBuilderStatus());
    });
    row.addEventListener("focusin", () => {
      if (kind === "face") selectedBuilderFace = index;
      else selectedBuilderTorso = index;
      for (const [rowIndex, candidate] of [...host.children].entries()) candidate.classList.toggle("selected", rowIndex === index);
      drawBuilderCompositePreview();
    });
    row.append(preview, details, remove);
    host.append(row);
  });
}

function renderBuilderParts(): void {
  renderBuilderPartList(builderFaces, builderFaceList, "face");
  renderBuilderPartList(builderTorsos, builderTorsoList, "torso");
  drawBuilderCompositePreview();
  updateBuilderControls();
}

async function addBuilderPartFiles(kind: "face" | "torso", files: readonly File[]): Promise<void> {
  const parts = kind === "face" ? builderFaces : builderTorsos;
  if (parts.length + files.length > 20) throw new Error(`A mix-and-match character can have at most 20 ${kind === "face" ? "faces" : "bodies"}`);
  const defaults = kind === "face" ? [9, 1, 2, 3, 4, 5, 6, 7, 8] : [9, 10, 11, 12, 13, 14];
  builderBusy = true;
  updateBuilderControls();
  try {
    for (const file of files) {
      setBuilderStatus(`Reading ${file.name}…`);
      const art = await imageFileToRgba(file);
      const emotion = defaults[parts.length % defaults.length];
      parts.push({
        filename: file.name,
        art,
        emotion,
        intensity: emotion === 9 ? 0 : 0.8,
        neck: { x: Math.round(art.width / 2), y: kind === "face" ? Math.max(0, art.height - 1) : Math.min(1, art.height) },
      });
    }
  } finally {
    builderBusy = false;
    renderBuilderParts();
  }
  setBuilderStatus(compositeBuilderStatus());
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
    emotion.className = "builder-advanced";
    emotion.setAttribute("aria-label", `Emotion for ${pose.filename}`);
    for (const [value, label] of BUILDER_EMOTIONS) emotion.append(new Option(label, String(value)));
    emotion.value = String(pose.emotion);
    emotion.addEventListener("change", () => {
      pose.emotion = Number(emotion.value);
      if (pose.emotion === 9) {
        pose.intensity = 0;
        intensity.value = "0";
        intensityValue.value = builderIntensityLabel(0);
      }
    });
    const intensityLabel = document.createElement("label");
    intensityLabel.className = "builder-advanced";
    intensityLabel.textContent = "Intensity ";
    const intensity = document.createElement("input");
    intensity.type = "range";
    intensity.min = "0";
    intensity.max = "100";
    intensity.value = String(Math.round(pose.intensity * 100));
    const intensityValue = document.createElement("output");
    intensityValue.value = builderIntensityLabel(Number(intensity.value));
    intensity.addEventListener("input", () => {
      pose.intensity = Number(intensity.value) / 100;
      intensityValue.value = builderIntensityLabel(Number(intensity.value));
    });
    intensityLabel.append(intensity, intensityValue);
    const quickEmotion = document.createElement("span");
    quickEmotion.className = "builder-quick-emotion";
    quickEmotion.textContent = `${BUILDER_EMOTION_NAMES.get(pose.emotion) ?? "Core"} pose`;
    details.append(filename, quickEmotion, emotion, intensityLabel);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${pose.filename}`);
    remove.addEventListener("click", () => {
      builderPoses.splice(index, 1);
      if (builderMode() === "quick") {
        builderPoses.forEach((remaining, remainingIndex) => {
          remaining.emotion = QUICK_BUILDER_EMOTIONS[remainingIndex];
          remaining.intensity = remaining.emotion === 9 ? 0 : 0.8;
        });
      }
      renderBuilderPoses();
      setBuilderStatus(builderMode() === "quick" ? quickBuilderStatus() : builderPoses.length ? `${builderPoses.length} pose images ready.` : "Add at least one neutral pose.");
    });
    row.append(preview, details, remove);
    builderPoseList.append(row);
  });
  updateBuilderControls();
}

async function addBuilderPoseFiles(files: readonly File[]): Promise<void> {
  const advanced = builderMode() === "advanced";
  const maximum = advanced ? 24 : QUICK_BUILDER_EMOTIONS.length;
  if (builderPoses.length + files.length > maximum) {
    throw new Error(advanced ? "An expressive character can have at most 24 poses" : "Core character uses exactly 14 expression and gesture images. Choose Expressive character to add more.");
  }
  const defaults = [9, 1, 5, 6, 10, 8, 7, 14];
  builderBusy = true;
  updateBuilderControls();
  try {
    for (const file of files) {
      setBuilderStatus(`Reading ${file.name}…`);
      const art = await imageFileToRgba(file);
      const emotion = advanced ? defaults[builderPoses.length % defaults.length] : QUICK_BUILDER_EMOTIONS[builderPoses.length];
      builderPoses.push({ filename: file.name, art, emotion, intensity: emotion === 9 ? 0 : 0.8 });
    }
  } finally {
    builderBusy = false;
    renderBuilderPoses();
  }
  setBuilderStatus(advanced
    ? `${builderPoses.length} pose ${builderPoses.length === 1 ? "image" : "images"} ready. Assign the matching emotion to each.`
    : quickBuilderStatus());
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
    const shared = {
      name,
      credit: builderCreditInput.value,
      style: builderStyleSelect.value === "color" ? "color" : "mono",
      aura: Number(builderAuraInput.value),
    } as const;
    const buffer = compositeBuilderActive()
      ? await buildCompositeAvatar({ ...shared, faces: builderFaces, torsos: builderTorsos })
      : await buildSimpleAvatar({ ...shared, poses: builderPoses });
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
  let community = communityAvatarByAnnouncement.get(announcement.name.toLocaleLowerCase());
  if (!announcement.url && !community) {
    await refreshCommunityAvatarCatalog().catch(() => {});
    community = communityAvatarByAnnouncement.get(announcement.name.toLocaleLowerCase());
  }
  const hostedUrl = announcement.url ?? community?.fileUrl;
  const url = sameOriginAvatarUrl(hostedUrl ? new URL(hostedUrl, window.location.href).href : undefined, new URL(window.location.href));
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

function loadCommunityAvatar(entry: HostedCommunityAvatar): Promise<LoadedAvatar> {
  const existing = communityAvatarLoads.get(entry.id);
  if (existing) return existing;
  const absoluteUrl = new URL(entry.fileUrl, window.location.href).href;
  const pending = fetchAvatarFile(absoluteUrl)
    .then((buffer) => validateAvatarImport(buffer, entry.file).then((imported) => loadedAvatar(buffer, imported.metadata)))
    .then((avatar) => {
      const resolved = Promise.resolve(avatar);
      avatarCache.set(entry.fileUrl, resolved);
      avatarCache.set(absoluteUrl, resolved);
      return avatar;
    });
  communityAvatarLoads.set(entry.id, pending);
  return pending;
}

async function useCommunityAvatar(entry: HostedCommunityAvatar): Promise<void> {
  if (!sessionCustomAvatars.has(entry.fileUrl) && sessionCustomAvatars.size >= MAX_SESSION_CUSTOM_AVATARS) {
    throw new Error("This tab already has the maximum of 24 custom avatars");
  }
  await loadCommunityAvatar(entry);
  const absoluteUrl = new URL(entry.fileUrl, window.location.href).href;
  sessionCustomAvatars.add(entry.fileUrl);
  acceptedHostedAvatars.add(absoluteUrl);
  if (![...characterSelect.options].some((option) => option.value === entry.fileUrl)) {
    characterSelect.append(new Option(`${entry.name} — Community`, entry.fileUrl));
  }
  characterSelect.value = entry.fileUrl;
  resetEmotionWheel();
  frozenPoses.delete(entry.fileUrl);
  await updateCharacterPreview();
  updateControls();
  const announced = announceSelectedAvatar();
  communityAvatarsDialog.close();
  setStatus(liveClient.joined && announced
    ? `You are now appearing as ${entry.name}. People allowing community art can see it.`
    : `${entry.name} is selected. It is hosted by WebComicChat and ready for live chat.`);
}

function drawCommunityAvatarIcon(canvas: HTMLCanvasElement, source?: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!source) {
    context.fillStyle = "#000080";
    context.font = "700 14px 'MS Sans Serif', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("AVB", canvas.width / 2, canvas.height / 2);
    return;
  }
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    (canvas.width - source.width * scale) / 2,
    (canvas.height - source.height * scale) / 2,
    source.width * scale,
    source.height * scale,
  );
}

async function communityApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Community service returned ${response.status}`);
  return body as T;
}

async function refreshCommunityAvatarCatalog(): Promise<void> {
  const response = await communityApi<{ avatars?: unknown[]; hiddenIds?: unknown[] }>("/api/community-avatars", { cache: "no-store" });
  const dynamic = parseCommunityAvatarCatalog({ version: 1, avatars: response.avatars }).avatars
    .map((entry): HostedCommunityAvatar => ({ ...entry, fileUrl: `/community-avatars/${entry.file}` }));
  const hidden = new Set((response.hiddenIds ?? []).filter((id): id is string => typeof id === "string"));
  const dynamicIds = new Set(dynamic.map(({ id }) => id));
  communityAvatars = [
    ...bundledCommunityAvatars.filter(({ id }) => !hidden.has(id) && !dynamicIds.has(id)),
    ...dynamic,
  ];
  indexCommunityAvatars();
}

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function publishCommunityAvatar(): Promise<void> {
  const file = communityAvatarUploadFile.files?.[0];
  if (!file) throw new Error("Choose an .avb file to upload");
  if (!communityAvatarUploadRights.checked || !communityAvatarUploadRules.checked) {
    throw new Error("Confirm both the sharing rights and the community content rules");
  }
  communityAvatarUploadSubmit.disabled = true;
  communityAvatarUploadStatus.textContent = "Checking the entire avatar file…";
  try {
    const buffer = await file.arrayBuffer();
    const validated = await validateAvatarImport(buffer, file.name);
    communityAvatarUploadStatus.textContent = "Technical check passed. Publishing…";
    const result = await communityApi<{ avatar: CommunityAvatarEntry }>("/api/community-avatars", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        fileBase64: arrayBufferBase64(buffer),
        name: communityAvatarUploadName.value.trim() || validated.name,
        creator: communityAvatarUploadCreator.value.trim(),
        description: communityAvatarUploadDescription.value.trim(),
        sourceUrl: communityAvatarUploadSource.value.trim(),
        rightsConfirmed: true,
        rulesConfirmed: true,
      }),
    });
    await refreshCommunityAvatarCatalog();
    renderCommunityAvatarGallery();
    communityAvatarCatalogStatus.textContent = `${communityAvatars.length} ${communityAvatars.length === 1 ? "avatar" : "avatars"} available`;
    communityAvatarUploadDialog.close();
    communityAvatarUploadDialog.querySelector("form")?.reset();
    communityAvatarUploadStatus.textContent = "";
    setStatus(`${result.avatar.name} passed validation and is now available in Community Avatars.`);
  } finally {
    communityAvatarUploadSubmit.disabled = false;
  }
}

let reportedCommunityAvatar: HostedCommunityAvatar | undefined;

function openCommunityAvatarReport(entry: HostedCommunityAvatar): void {
  reportedCommunityAvatar = entry;
  communityAvatarReportName.textContent = `Report “${entry.name}” if it breaks the community content or sharing rules.`;
  communityAvatarReportReason.value = "";
  communityAvatarReportDetails.value = "";
  communityAvatarReportStatus.textContent = "";
  communityAvatarReportDialog.showModal();
}

async function submitCommunityAvatarReport(): Promise<void> {
  if (!reportedCommunityAvatar) throw new Error("Choose an avatar to report");
  if (!communityAvatarReportReason.value) throw new Error("Choose a report reason");
  communityAvatarReportSubmit.disabled = true;
  communityAvatarReportStatus.textContent = "Sending report…";
  try {
    await communityApi(`/api/community-avatars/${encodeURIComponent(reportedCommunityAvatar.id)}/reports`, {
      method: "POST",
      body: JSON.stringify({ reason: communityAvatarReportReason.value, details: communityAvatarReportDetails.value.trim() }),
    });
    communityAvatarReportStatus.textContent = "Report sent. Thank you.";
    setStatus(`Report sent for ${reportedCommunityAvatar.name}.`);
    setTimeout(() => {
      if (communityAvatarReportDialog.open) communityAvatarReportDialog.close();
    }, 700);
  } finally {
    communityAvatarReportSubmit.disabled = false;
  }
}

function renderCommunityAvatarGallery(): void {
  communityAvatarList.replaceChildren();
  if (communityAvatars.length === 0) {
    const empty = document.createElement("p");
    empty.className = "community-avatar-empty";
    empty.textContent = "No community avatars have been published yet.";
    communityAvatarList.append(empty);
    return;
  }

  for (const entry of communityAvatars) {
    const card = document.createElement("article");
    card.className = "community-avatar-card";
    const preview = document.createElement("canvas");
    preview.width = 72;
    preview.height = 72;
    preview.setAttribute("aria-label", `${entry.name} preview`);
    drawCommunityAvatarIcon(preview);
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = entry.name;
    const creator = document.createElement("small");
    creator.textContent = entry.creator ? `By ${entry.creator}` : "Community character";
    const description = document.createElement("p");
    description.textContent = entry.description ?? "A community-made Comic Chat character.";
    copy.append(name, creator, description);
    if (entry.sourceUrl) {
      const source = document.createElement("a");
      source.href = entry.sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = "Source & credit ↗";
      copy.append(source);
    }
    const use = document.createElement("button");
    use.type = "button";
    use.disabled = true;
    use.textContent = "Checking…";
    use.addEventListener("click", () => {
      use.disabled = true;
      use.textContent = "Loading…";
      void useCommunityAvatar(entry).catch((error) => {
        use.disabled = false;
        use.textContent = "Try again";
        showError(error);
      });
    });
    const report = document.createElement("button");
    report.type = "button";
    report.textContent = "Report";
    report.addEventListener("click", () => openCommunityAvatarReport(entry));
    const actions = document.createElement("div");
    actions.className = "community-avatar-card-actions";
    actions.append(use, report);
    card.append(preview, copy, actions);
    communityAvatarList.append(card);
    void loadCommunityAvatar(entry).then(avatarIcon).then((icon) => {
      if (!card.isConnected) return;
      drawCommunityAvatarIcon(preview, icon);
      use.disabled = false;
      use.textContent = characterSelect.value === entry.fileUrl ? "Use again" : "Use avatar";
    }).catch((error) => {
      card.classList.add("invalid");
      use.disabled = true;
      use.textContent = "Unavailable";
      description.textContent = error instanceof Error ? `This avatar failed validation: ${error.message}` : "This avatar failed validation.";
    });
  }
}

function showCommunityAvatarGallery(): void {
  renderCommunityAvatarGallery();
  communityAvatarsDialog.showModal();
  communityAvatarCatalogStatus.textContent = "Checking for new uploads…";
  void refreshCommunityAvatarCatalog().then(() => {
    renderCommunityAvatarGallery();
    communityAvatarCatalogStatus.textContent = `${communityAvatars.length} ${communityAvatars.length === 1 ? "avatar" : "avatars"} available`;
  }).catch((error) => {
    communityAvatarCatalogStatus.textContent = "Could not refresh; showing bundled avatars.";
    setStatus(error instanceof Error ? error.message : "Could not refresh community avatars");
  });
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
  const name = characters.find((choice) => choice.file === file)?.label.split(" —")[0]
    || communityAvatarByFile.get(file)?.name
    || avatar.name
    || "Character";
  return name.toLocaleLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function studioPoseChoice(avatar: AvatarFile, pose: StudioPoseId): PoseChoice | undefined {
  if (pose === "auto") return undefined;
  const wheelEmotion = STUDIO_WHEEL_EMOTIONS[pose];
  if (wheelEmotion !== undefined) {
    return posesForWheel(avatar, {
      emotion: wheelEmotion,
      intensity: pose === "neutral" ? 0 : 1,
    }, newPoseMemory());
  }
  const gesture = STUDIO_GESTURES[pose];
  if (gesture === undefined) return undefined;
  return choosePoses(avatar, [{ emotion: gesture, intensity: 1, priority: 100, source: "Offline Comic Studio" }], newPoseMemory());
}

function drawPosePreview(canvas: HTMLCanvasElement, bitmap: DecodedBitmap): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const source = bitmapCanvas(bitmap);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width - 12) / bitmap.width, (canvas.height - 10) / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, (canvas.width - width) / 2, canvas.height - height - 4, width, height);
}

async function updateWorkshopPosePreview(): Promise<void> {
  const generation = ++workshopPosePreviewGeneration;
  const characterFile = workshopAddCharacter.value;
  if (!characterFile) return;
  workshopAddPosePreview.classList.add("loading");
  const avatar = await loadAvatar(characterFile);
  const pose = workshopAddPose.value as StudioPoseId;
  const choice = studioPoseChoice(avatar.metadata, pose);
  const body = choice
    ? await composeChoice(avatar.buffer, avatar.metadata, choice)
    : await bodyForText(avatar.buffer, avatar.metadata, workshopAddMessage.value, newPoseMemory());
  if (generation !== workshopPosePreviewGeneration) return;
  drawPosePreview(workshopAddPosePreview, body.bitmap);
  const poseLabel = STUDIO_POSES.find((candidate) => candidate.id === pose)?.label ?? "Selected pose";
  const characterName = selectedWorkshopCharacterName();
  workshopAddPoseCaption.textContent = pose === "auto" ? `${characterName} · Automatic from dialogue` : `${characterName} · ${poseLabel}`;
  workshopAddPosePreview.setAttribute("aria-label", `Preview of ${characterName}: ${poseLabel}`);
  workshopAddPosePreview.classList.remove("loading");
}

function scheduleWorkshopPosePreview(): void {
  if (workshopPosePreviewTimer !== undefined) clearTimeout(workshopPosePreviewTimer);
  workshopPosePreviewTimer = setTimeout(() => {
    workshopPosePreviewTimer = undefined;
    void updateWorkshopPosePreview().catch(showError);
  }, 120);
}

async function createConversationLine(
  characterFile: string,
  message: string,
  displayName?: string,
  mode: BalloonMode = "say",
  selected: readonly string[] = [],
  linkable = mode !== "whisper",
  studioPose: StudioPoseId = "auto",
  annotation?: ComicChatAnnotation,
): Promise<ConversationLine> {
  const avatar = await loadAvatar(characterFile);
  const explicitStudioPose = studioPoseChoice(avatar.metadata, studioPose);
  // A line from the original Comic Chat client carries the pose its sender chose.
  const annotatedPose = annotation ? poseForAnnotation(avatar.metadata, annotation) ?? undefined : undefined;
  const frozen = studioPose === "auto" && !annotation ? frozenPoses.get(characterFile) : undefined;
  if (frozen) frozenPoses.delete(characterFile);
  const chosenPose = explicitStudioPose ?? annotatedPose ?? frozen;
  const body = chosenPose
    ? await composeChoice(avatar.buffer, avatar.metadata, chosenPose)
    : await bodyForText(avatar.buffer, avatar.metadata, message, avatar.memory);
  cacheBody(avatar, body);
  const options = emotionOptions(message);
  const characterName = displayName || displayCharacterName(avatar.metadata, characterFile);
  const display = linkable
    ? displayMessageLinks(message)
    : { text: message.length <= 180 ? message : `${message.slice(0, 179)}…`, links: [] };
  return {
    characterFile,
    characterName,
    message,
    displayMessage: display.text,
    links: display.links,
    mode,
    body,
    poseRef: `${characterFile}|${body.key}`,
    expression: explicitStudioPose
      ? STUDIO_POSES.find((candidate) => candidate.id === studioPose)?.label ?? "studio pose"
      : annotatedPose ? "Comic Chat pose" : frozen ? "wheel selection" : describeOptions(options),
    talkTo: addressedPeople(message, characterName, selected),
    linkable,
    studioPose,
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

function saveComicDisplayPreferences(): void {
  try {
    localStorage.setItem("comic-chat-hidden-bots", JSON.stringify([...hiddenComicBots]));
    localStorage.setItem("comic-chat-censor-content", censorContent ? "1" : "0");
    localStorage.removeItem("comic-chat-hide-bettybot");
  } catch {}
}

function toggleHiddenComicBot(nickname: string): void {
  const key = normalizedComicNickname(nickname);
  const hidden = hiddenComicBots.has(key);
  if (hidden) hiddenComicBots.delete(key);
  else hiddenComicBots.add(key);
  saveComicDisplayPreferences();
  updateControls();
  void renderStrip().then(() => {
    setStatus(hidden
      ? `${nickname} is visible in the comic and saved PNGs.`
      : `${nickname} is hidden from the comic and saved PNGs. Incoming IRC messages are unchanged.`);
  }).catch(showError);
}

function displayLineWithCensor(line: ConversationLine): ConversationLine {
  if (!censorContent) return line;
  const censored = censorComicText(line.message);
  if (censored === line.message) return line;
  const display = line.linkable
    ? displayMessageLinks(censored)
    : { text: censored.length <= 180 ? censored : `${censored.slice(0, 179)}…`, links: [] };
  return { ...line, displayMessage: display.text, links: display.links };
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

function selectedAvatarAnnouncement(): { name: string; message: string } | undefined {
  const officialName = selectedOfficialAvatarName();
  if (officialName) return { name: officialName, message: `# Appears as ${officialName}` };
  const community = communityAvatarByFile.get(characterSelect.value);
  if (!community || window.location.protocol !== "https:") return undefined;
  return {
    name: community.name,
    message: `# Appears as ${community.announcementName}`,
  };
}

function selectedAvatarDisplayName(): string | undefined {
  return selectedAvatarAnnouncement()?.name;
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
  const announcement = selectedAvatarAnnouncement();
  if (!announcement) return false;
  liveClient.say(announcement.message);
  return true;
}

function characterForNickname(nickname: string): string {
  if (nicknameInput.value && nickname.toLocaleLowerCase() === nicknameInput.value.toLocaleLowerCase()) {
    return characterSelect.value;
  }
  const announcement = announcedAvatars.get(memberAvatarRuleKey(nickname));
  const community = announcement ? communityAvatarByAnnouncement.get(announcement.name.toLocaleLowerCase()) : undefined;
  const hosted = !avatarDisplayPolicy.officialOnly
    ? sameOriginAvatarUrl(announcement?.url ?? (community ? new URL(community.fileUrl, window.location.href).href : undefined), new URL(window.location.href))
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
    if (line.blankPanel) return line;
    const member = [...knownMembers].find((nickname) => nickname.toLocaleLowerCase() === line.characterName.toLocaleLowerCase());
    if (!member || (nicknames && !nicknames.has(member))) return line;
    const nextFile = characterForNickname(member);
    if (line.characterFile === nextFile) return line;
    const replacement = await createConversationLine(nextFile, line.message, line.characterName, line.mode, line.talkTo, line.linkable, line.studioPose);
    return { ...replacement, breakBefore: line.breakBefore, stayInPanel: line.stayInPanel, reaction: line.reaction };
  }));
  if (generation !== avatarRemapGeneration) return;
  conversation.splice(0, conversation.length, ...replacements);
  await renderStrip();
}

async function refreshAvatarArtPreference(): Promise<void> {
  const generation = ++avatarRemapGeneration;
  const replacements = await Promise.all(conversation.map(async (line) => {
    if (line.blankPanel) return line;
    const member = [...knownMembers].find((nickname) => nickname.toLocaleLowerCase() === line.characterName.toLocaleLowerCase());
    const nextFile = member ? characterForNickname(member) : preferredAvatarFile(line.characterFile);
    if (line.characterFile === nextFile) return line;
    const replacement = await createConversationLine(nextFile, line.message, line.characterName, line.mode, line.talkTo, line.linkable, line.studioPose);
    return { ...replacement, breakBefore: line.breakBefore, stayInPanel: line.stayInPanel, reaction: line.reaction };
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
    text: clean,
    mode: action ? "action" : "say",
  };
}

function appendConversationLine(line: ConversationLine, rolling = false): void {
  if (rolling && conversation.length >= MAX_LIVE_LINES) {
    conversation.shift();
  }
  conversation.push(line);
  announceLine(line);
  void renderStrip().catch(showError);
}

function queueLocalComic(task: () => Promise<void>): void {
  localComicQueue = localComicQueue.then(task, task).catch(showError);
}

async function appendLocalScript(entries: ReadonlyArray<{
  file: string;
  message: string;
  name?: string;
  mode?: BalloonMode;
  reaction?: boolean;
  breakBefore?: boolean;
}>): Promise<void> {
  const lines: ConversationLine[] = [];
  for (const entry of entries) {
    const line = await createConversationLine(entry.file, entry.message, entry.name, entry.mode ?? "say", [], false);
    line.reaction = entry.reaction;
    line.breakBefore = entry.breakBefore;
    lines.push(line);
  }
  while (conversation.length + lines.length > MAX_LIVE_LINES) conversation.shift();
  conversation.push(...lines);
  await renderStrip();
}

function addLocalSelfMessage(message: string, mode: BalloonMode = "say"): void {
  queueLocalComic(async () => {
    await appendLocalScript([{ file: characterSelect.value, message, mode, breakBefore: true }]);
    setStatus("A local-only surprise was added to your comic.");
  });
}

function playHelpEgg(): void {
  if (helpEggShown) {
    setStatus("Tip: :) smiles, ALL CAPS shouts, and starting with “Hi” waves.");
    messageInput.focus();
    return;
  }
  helpEggShown = true;
  queueLocalComic(async () => {
    await appendLocalScript([
      { file: characterSelect.value, message: "IT LOOKS LIKE YOU'RE MAKING A COMIC! WANT SOME TIPS?", breakBefore: true },
      { file: characterSelect.value, message: "TRY :) TO SMILE, ALL CAPS TO SHOUT, OR START WITH HI TO WAVE.", breakBefore: true },
    ]);
    setStatus("F1 tips are local only—they were not sent to the room.");
  });
}

function playOriginalCredits(): void {
  queueLocalComic(async () => {
    await appendLocalScript([
      { file: "tiki.avb", name: "David Kurlander", message: "HI THERE! WELCOME TO OUR EASTER EGG. I CREATED MICROSOFT CHAT.", breakBefore: true },
      { file: "armando.avb", name: "Regis Brid", message: "REGIS BRID HERE, DEVELOPER DOUBLE-O-SEVEN.", breakBefore: true },
      { file: "tongtyed.avb", name: "Teoman Smith", message: "I'M TEOMAN SMITH, PROGRAM MANAGEMENT.", breakBefore: true },
      { file: "hugh.avb", name: "Janise Kieffer", message: "TEST LEAD. 100% BUG FREE. LOL!", breakBefore: true },
      { file: "xeno.avb", name: "Jim Campbell", message: "I CREATED THE CHARACTER EDITOR!", breakBefore: true },
      { file: "jordan.avb", name: "Jim Woodring", message: "COMIC ARTIST. AND OF COURSE, THANKS TO ALL OUR USERS.", breakBefore: true },
    ]);
    setStatus("You found the original Comic Chat creators Easter egg.");
  });
}

async function addRemoteMessage(event: LiveMessageEvent, generation: number): Promise<void> {
  if (event.self || generation !== liveComicGeneration) return;
  const unsafeLink = blockedMessageLink(event.message);
  if (unsafeLink) throw new Error(blockedLinkMessage(unsafeLink));
  knownMembers.add(event.nickname);
  // Comic Chat answers a room-wide appearance announcement privately. Those
  // replies are metadata, not whispers for the comic, and are how a late
  // joiner learns the characters already present in the room.
  const announcement = parseAvatarAnnouncement(event.message);
  if (announcement) {
    announcedAvatars.set(memberAvatarRuleKey(event.nickname), announcement);
    if (!event.whisper) {
      const ownAvatar = selectedAvatarAnnouncement();
      if (ownAvatar) liveClient.whisper([event.nickname], ownAvatar.message);
    }
    let hostedFile: string | undefined;
    let hostedError: unknown;
    if (!announcedOfficialFile(event.nickname) && !avatarDisplayPolicy.officialOnly) {
      try {
        hostedFile = await prepareHostedAvatar(event.nickname);
      } catch (error) {
        hostedError = error;
      }
    }
    if (generation !== liveComicGeneration) return;
    renderMembers();
    renderAvatarRules();
    await refreshMemberAvatars(new Set([event.nickname]));
    if (generation !== liveComicGeneration) return;
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
  const normalized = normalizeIrcText(event.message);
  // The original Comic Chat client prefixes its lines with "(#G…E…M…T…) ":
  // the pose, balloon and addressees. Draw those instead of the prefix.
  const annotation = normalized.mode === "say" ? parseComicChatAnnotation(normalized.text, event.whisper) ?? undefined : undefined;
  // Draw bots' AI-marked lines without the marker; take a "Name:" prefix off
  // the balloon and turn the speaker toward those people instead.
  const addressed = parseAddressing(withoutAiMarker(event.nickname, annotation?.text ?? normalized.text), knownMembers);
  const { text } = addressed;
  if (!text) return;
  // A whisper shows in this room's comic only for the person it was sent to,
  // with the sender facing them, as Comic Chat drew it.
  const sentMode = annotation?.mode ?? normalized.mode;
  const mode: BalloonMode = event.whisper && sentMode !== "action" ? "whisper" : sentMode;
  const characterFile = characterForNickname(event.nickname);
  const whisperTarget = typeof event.to === "string" ? [event.to] : [];
  const annotatedTo = (annotation?.talkTo ?? []).flatMap((name) => [...knownMembers].filter((member) => member.toLocaleLowerCase() === name.toLocaleLowerCase()));
  const faceToward = event.whisper ? whisperTarget : addressed.to.length ? addressed.to : annotatedTo;
  const line = await createConversationLine(characterFile, text, event.nickname, mode, faceToward, !event.whisper, "auto", annotation);
  if (generation !== liveComicGeneration) return;
  appendConversationLine(line, true);
  setStatus(`${event.nickname}${event.whisper ? " whispered to you" : ""}: ${line.expression} · live IRC`);
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
    updateControls();
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
  updateControls();
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

function setRoomBrowserVisible(visible: boolean): void {
  roomBrowser.hidden = !visible;
  if (visible) {
    roomTabLabel.textContent = "Channel list";
    windowRoom.textContent = "Channel List";
  } else if (liveState === "joined" && joinedChannel) {
    roomTabLabel.textContent = joinedChannel;
    windowRoom.textContent = joinedChannel;
  } else {
    roomTabLabel.textContent = "Offline comic";
    windowRoom.textContent = "Not connected";
  }
  refreshRoomsButton.disabled = !visible || (liveState !== "browsing" && liveState !== "joined");
}

function joinRoom(channel: string): void {
  const room = normalizeRoomSelection(networkSelect.value, channel);
  if (!room) throw new Error("That room name is not IRC-safe");
  channelInput.value = room.channel;
  liveClient.join(room.channel);
  setRoomBrowserVisible(false);
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
    empty.textContent = publicRooms.size === 0 ? "Waiting for the server's public channel list…" : "No channels match that search.";
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
  roomSummary.textContent = `${matching.length} shown · ${totalPublicRooms || publicRooms.size} public channels found`;
}

function setConnectionGuidance(lead: string, detail: string): void {
  const strong = document.createElement("strong");
  strong.textContent = lead;
  connectionGuidance.replaceChildren(strong, ` ${detail}`);
}

function updateLiveUi(state: LiveState, message: string): void {
  liveState = state;
  liveConsole.dataset.state = state;
  liveStatus.textContent = state === "offline" || state === "disconnected" ? "Offline — not connected" : message;
  const active = state === "connecting" || state === "browsing" || state === "joining" || state === "joined";
  const busy = state === "connecting" || state === "joining";
  networkSelect.disabled = active;
  nicknameInput.disabled = active;
  channelInput.disabled = busy;
  connectionGuidance.hidden = state === "joined";
  if (state === "offline" || state === "disconnected") {
    setConnectionGuidance("You’re offline.", `Choose a nickname, then join ${channelInput.value || DEFAULT_ROOM_SELECTION.channel} to start chatting.`);
  } else if (state === "browsing") {
    setConnectionGuidance("You’re connected to IRC, but not in a channel.", "Choose a channel below or type one above.");
  } else if (state === "connecting") {
    setConnectionGuidance("Connecting to IRC…", "This normally takes only a moment.");
  } else if (state === "joining") {
    setConnectionGuidance(`Joining ${channelInput.value}…`, "Waiting for the channel to accept the connection.");
  }
  connectButton.disabled = busy;
  browseRoomsButton.disabled = busy;
  disconnectButton.disabled = !active;
  addLabel.textContent = state === "joined" ? "Send to room" : "Add to comic";
  setRoomBrowserVisible(state === "browsing");
  updateControls();
  refreshEmptyStrip();
}

function notificationModeLabel(mode: NotifyMode): string {
  if (mode === "wake") return "Room wake-up";
  if (mode === "mentions") return "Mentions only";
  return "Off";
}

function renderNotificationSleep(): void {
  const sleeping = pendingNotifySleepUntil > Date.now();
  notificationSleepStatus.textContent = sleeping
    ? `Snoozed until ${new Date(pendingNotifySleepUntil).toLocaleString()}`
    : "Not snoozed";
  notificationResume.disabled = !sleeping;
}

function renderNotificationPermission(): void {
  const permission = desktopPermission();
  notificationPermission.textContent = permission === "granted"
    ? "Desktop alerts are allowed. Clicking one returns to this tab."
    : permission === "denied"
      ? "Desktop alerts are blocked in your browser settings; tab counts and optional chimes still work."
      : permission === "unsupported"
        ? "This browser does not offer desktop alerts; tab counts and optional chimes still work."
        : "Your browser will ask for desktop-alert permission when you save an enabled mode.";
}

function openNotificationSettings(): void {
  const selected = notificationDialog.querySelector<HTMLInputElement>(`input[name="notification-mode"][value="${notifyPolicy.settings.mode}"]`);
  if (selected) selected.checked = true;
  notificationSound.checked = notifyPolicy.settings.sound;
  notificationWatch.value = notifyPolicy.settings.watch.join("\n");
  pendingNotifySleepUntil = notifyPolicy.settings.sleepUntil;
  renderNotificationSleep();
  renderNotificationPermission();
  notificationDialog.showModal();
}

function deliverNotification(alert: Alert): void {
  if (notifyPolicy.settings.sound) chime();
  if (document.hidden) showDesktop(alert, classicAppIconUrl);
  tabAttention.show(notifyPolicy.unread);
}

function inspectMessageForNotification(event: LiveMessageEvent): void {
  // Appearance announcements are client metadata, not conversation.
  if (parseAvatarAnnouncement(event.message)) return;
  const annotation = parseComicChatAnnotation(event.message, event.whisper);
  const alert = notifyPolicy.message({
    nick: event.nickname,
    text: withoutAiMarker(event.nickname, annotation?.text ?? event.message),
    myNick: joinedNickname || nicknameInput.value.trim(),
    self: event.self,
    whisper: event.whisper,
    channel: joinedChannel || channelInput.value,
    hidden: document.hidden,
    at: event.timestamp || Date.now(),
  });
  if (alert) deliverNotification(alert);
  else if (document.hidden) tabAttention.show(notifyPolicy.unread);
}

function handleLiveEvent(event: LiveEvent): void {
  if (event.type === "status") {
    if (event.state === "joined") {
      joinedChannel = event.channel ?? channelInput.value;
      joinedNickname = event.nickname ?? nicknameInput.value.trim();
      notifyPolicy.resetRoom();
      tabAttention.show(0);
    }
    else if (event.state === "offline" || event.state === "disconnected") {
      joinedChannel = "";
      joinedNickname = "";
      pendingLiveLines.length = 0;
    }
    updateLiveUi(event.state, event.message);
    if (event.state === "browsing") renderRoomList();
    if (event.state === "joined") {
      const channel = event.channel ?? channelInput.value;
      channelInput.value = channel;
      roomTabLabel.textContent = channel;
      windowRoom.textContent = channel;
      knownMembers.clear();
      if (event.nickname) knownMembers.add(event.nickname);
      renderMembers();
      const announced = announceSelectedAvatar();
      setStatus(`${event.message}. New channel messages will become panels.${announced ? ` You are appearing as ${selectedAvatarDisplayName()}.` : " Your imported avatar remains local to this tab."}`);
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
      roomDirectoryLoaded = false;
    } else {
      totalPublicRooms = event.total ?? event.count;
      roomDirectoryLoaded = true;
    }
    roomSummary.textContent = event.reset ? "Loading rooms…" : `${event.count} popular rooms shown`;
    renderRoomList();
    return;
  }
  if (event.type === "members") {
    knownMembers.clear();
    for (const nickname of event.members) knownMembers.add(nickname);
    renderMembers();
    for (const alert of notifyPolicy.roster(event.members, joinedChannel || channelInput.value, Date.now())) {
      deliverNotification(alert);
    }
    return;
  }
  if (event.type === "error") {
    if (event.operation === "message") pendingLiveLines.shift();
    liveConsole.dataset.state = "error";
    liveStatus.textContent = event.message;
    showError(new Error(event.message));
    return;
  }
  if (event.type === "blocked") {
    showError(new Error(event.message));
    return;
  }
  inspectMessageForNotification(event);
  if (event.self) {
    const pending = pendingLiveLines.shift();
    if (!pending) return;
    appendConversationLine(pending.line, true);
    setStatus(`${pending.line.characterName}: ${pending.line.expression} · ${pending.line.mode} balloon${pending.sentNote}`);
    return;
  }
  const generation = liveComicGeneration;
  remoteQueue = remoteQueue.then(() => addRemoteMessage(event, generation)).catch(showError);
}

const liveClient = new IrcWebClient(handleLiveEvent);

function syncPanelSelectionUi(): void {
  const selectedCount = selectedPanelIndexes(panelKeys, selectedPanelKeys).length;
  panelSelectionBar.hidden = !panelSelectionMode;
  strip.classList.toggle("selecting-panels", panelSelectionMode);
  selectPanelsButton.setAttribute("aria-pressed", String(panelSelectionMode));
  selectPanelsButton.textContent = panelSelectionMode ? "Cancel Selection" : "Select Panels…";
  panelSelectionCount.textContent = selectedCount === 0
    ? "Tap the panels you want to save."
    : `${selectedCount} ${selectedCount === 1 ? "panel" : "panels"} selected.`;
  selectAllPanelsButton.disabled = panelKeys.length === 0 || selectedCount === panelKeys.length;
  clearPanelSelectionButton.disabled = selectedCount === 0;
  saveSelectedPanelsButton.disabled = selectedCount === 0 || isAdding || panelCanvases.length === 0;
  downloadButton.textContent = panelSelectionMode
    ? selectedCount > 0 ? `Save Selected (${selectedCount})` : "Save Selected"
    : "Save Comic";

  [...strip.querySelectorAll<HTMLElement>(".panel-card")].forEach((card, index) => {
    const key = panelKeys[index];
    const selected = Boolean(key && selectedPanelKeys.has(key));
    card.classList.toggle("panel-selected", panelSelectionMode && selected);
    if (panelSelectionMode && key) {
      card.tabIndex = 0;
      card.setAttribute("role", "checkbox");
      card.setAttribute("aria-checked", String(selected));
      card.setAttribute("aria-label", `${selected ? "Included" : "Not included"}: ${card.querySelector("canvas")?.getAttribute("aria-label") ?? `panel ${index + 1}`}`);
    } else {
      card.removeAttribute("tabindex");
      card.removeAttribute("role");
      card.removeAttribute("aria-checked");
      card.removeAttribute("aria-label");
    }
    for (const link of card.querySelectorAll<HTMLAnchorElement>("a")) {
      if (panelSelectionMode) {
        if (link.dataset.selectionTabindex === undefined) {
          link.dataset.selectionTabindex = link.getAttribute("tabindex") ?? "";
        }
        link.tabIndex = -1;
      } else if (link.dataset.selectionTabindex !== undefined) {
        const previous = link.dataset.selectionTabindex;
        if (previous === "") link.removeAttribute("tabindex");
        else link.setAttribute("tabindex", previous);
        delete link.dataset.selectionTabindex;
      }
    }
  });
}

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
  const whisperRecipients = selectedAddressees.size;
  const liveWhisper = liveState === "joined" && messageMode.value === "whisper";
  addButton.disabled = isAdding
    || messageInput.value.trim().length === 0
    || (liveWhisper && (whisperRecipients < 1 || whisperRecipients > 5));
  addLabel.textContent = liveWhisper
    ? whisperRecipients < 1
      ? "Select a whisper recipient"
      : whisperRecipients > 5
        ? "Too many recipients"
        : `Whisper to ${whisperRecipients}`
    : liveState === "joined"
      ? "Send to room"
      : "Add to comic";
  undoButton.disabled = conversation.length === 0 || isAdding;
  clearButton.disabled = conversation.length === 0 || isAdding;
  const selectedPanelCount = selectedPanelIndexes(panelKeys, selectedPanelKeys).length;
  downloadButton.disabled = panelCanvases.length === 0 || isAdding || (panelSelectionMode && selectedPanelCount === 0);
  selectPanelsButton.disabled = !panelSelectionMode && panelCanvases.length === 0;
  const room = normalizeRoomSelection(networkSelect.value, channelInput.value);
  const busy = liveState === "connecting" || liveState === "joining";
  const roomIsBookmarked = room !== undefined
    && roomBookmarks.some((bookmark) => roomBookmarkKey(bookmark) === roomBookmarkKey(room));
  const alreadyJoined = liveState === "joined"
    && room !== undefined
    && room.channel.toLocaleLowerCase() === joinedChannel.toLocaleLowerCase();
  shareRoomButton.disabled = !room;
  connectButton.disabled = busy || !room || alreadyJoined;
  connectButton.textContent = busy
    ? liveState === "joining" && room ? `Joining ${room.channel}…` : "Connecting…"
    : alreadyJoined
      ? `Joined ${joinedChannel}`
      : liveState === "joined" && room
        ? `Switch to ${room.channel}`
        : room
          ? `Join ${room.channel}`
          : "Enter a #channel";
  browseRoomsButton.disabled = busy;
  disconnectButton.disabled = !liveClient.active;
  refreshRoomsButton.disabled = roomBrowser.hidden || (liveState !== "browsing" && liveState !== "joined");
  liberaWebChatLink.hidden = networkSelect.value !== "libera";
  if (!liberaWebChatLink.hidden) {
    const channel = normalizeRoomSelection("libera", channelInput.value)?.channel ?? DEFAULT_ROOM_SELECTION.channel;
    liberaWebChatLink.href = createLiberaWebChatUrl(channel);
    liberaWebChatLink.textContent = `Open ${channel} in Libera web chat ↗`;
  }
  for (const button of menuCommandButtons) {
    const command = button.dataset.command ?? "";
    if (command === "new-comic" || command === "clear") button.disabled = clearButton.disabled;
    else if (command === "undo") button.disabled = undoButton.disabled;
    else if (command === "save-comic") button.disabled = downloadButton.disabled;
    else if (command === "join-channel") button.disabled = connectButton.disabled;
    else if (command === "browse-channels") button.disabled = browseRoomsButton.disabled;
    else if (command === "copy-channel") button.disabled = shareRoomButton.disabled;
    else if (command === "bookmark-room") {
      button.disabled = !room || roomIsBookmarked;
      button.textContent = roomIsBookmarked ? "Room is already bookmarked" : "Bookmark typed/current room";
    }
    else if (command === "disconnect") button.disabled = disconnectButton.disabled;
    else if (command === "select-panels") button.disabled = !panelSelectionMode && panelCanvases.length === 0;
    if (command.startsWith("mode-")) {
      button.setAttribute("aria-checked", String(command.slice(5) === messageMode.value));
    }
    const botNickname = HIDE_BOT_COMMANDS[command];
    if (botNickname) {
      button.setAttribute("aria-checked", String(hiddenComicBots.has(normalizedComicNickname(botNickname))));
    }
    if (command === "censor-content") button.setAttribute("aria-checked", String(censorContent));
    if (command === "plain-text-view") button.setAttribute("aria-checked", String(plainTextView));
    if (command === "select-panels") button.setAttribute("aria-checked", String(panelSelectionMode));
    if (command === "notifications") {
      const sleeping = notificationsSleeping(notifyPolicy.settings);
      button.textContent = `Notifications… (${sleeping ? "Snoozed" : notificationModeLabel(notifyPolicy.settings.mode)})`;
    }
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-room-bookmark-key]")) {
    button.disabled = busy;
  }
  syncPanelSelectionUi();
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
    ? `Channel link copied for ${room.channel}. It will not connect until opened and confirmed.`
    : `Channel link ready for ${room.channel}. Copy it from the address bar.`);
}

function roomNetworkLabel(network: RoomSelection["network"]): string {
  return network === "libera" ? "Libera.Chat" : "OFTC";
}

function saveRoomBookmarks(): void {
  try {
    localStorage.setItem(ROOM_BOOKMARKS_STORAGE_KEY, serializeRoomBookmarks(roomBookmarks));
  } catch {
    setStatus("The bookmark list works for this visit, but this browser would not save it permanently.");
  }
}

function openRoomBookmark(room: RoomSelection): void {
  const busy = liveState === "connecting" || liveState === "joining";
  if (busy) {
    setStatus("Wait for the current IRC connection to finish before opening another bookmark.");
    return;
  }

  const sameNetwork = networkSelect.value === room.network;
  const sameJoinedRoom = sameNetwork
    && liveState === "joined"
    && joinedChannel.toLocaleLowerCase() === room.channel.toLocaleLowerCase();
  if (sameJoinedRoom) {
    channelInput.value = room.channel;
    setStatus(`You are already in ${roomNetworkLabel(room.network)} ${room.channel}.`);
    updateControls();
    return;
  }

  if (liveClient.active && !sameNetwork) liveClient.disconnect();
  networkSelect.value = room.network;
  channelInput.value = room.channel;
  setRoomBrowserVisible(false);
  updateControls();
  connectButton.click();
}

function renderRoomBookmarks(): void {
  roomBookmarkMenuList.replaceChildren();
  roomBookmarkDialogList.replaceChildren();

  for (const room of roomBookmarks) {
    const pinned = isDefaultRoomBookmark(room);
    const label = `${roomNetworkLabel(room.network)} · ${room.channel}`;

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.dataset.roomBookmarkKey = roomBookmarkKey(room);
    menuButton.textContent = `${pinned ? "★" : "•"} ${label}`;
    menuButton.title = pinned ? "Pinned WebComicChat home room" : `Open ${label}`;
    menuButton.addEventListener("click", () => {
      closeClassicMenus();
      openRoomBookmark(room);
    });
    roomBookmarkMenuList.append(menuButton);

    const row = document.createElement("div");
    row.className = "room-bookmark-row";
    const description = document.createElement("span");
    const roomName = document.createElement("strong");
    roomName.textContent = room.channel;
    const networkName = document.createElement("small");
    networkName.textContent = pinned ? `${roomNetworkLabel(room.network)} · pinned home room` : roomNetworkLabel(room.network);
    description.append(roomName, networkName);
    const join = document.createElement("button");
    join.type = "button";
    join.dataset.roomBookmarkKey = roomBookmarkKey(room);
    join.textContent = "Join";
    join.addEventListener("click", () => {
      roomBookmarksDialog.close();
      openRoomBookmark(room);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = pinned ? "Pinned" : "Remove";
    remove.disabled = pinned;
    remove.title = pinned ? "The WebComicChat home room cannot be removed" : `Remove ${label}`;
    remove.addEventListener("click", () => {
      roomBookmarks = removeRoomBookmark(roomBookmarks, room);
      saveRoomBookmarks();
      renderRoomBookmarks();
      updateControls();
      setStatus(`${label} was removed from your room bookmarks.`);
    });
    row.append(description, join, remove);
    roomBookmarkDialogList.append(row);
  }
}

function bookmarkCurrentRoom(): void {
  const room = normalizeRoomSelection(networkSelect.value, channelInput.value);
  if (!room) throw new Error("Enter a valid #channel before bookmarking it");
  const existing = roomBookmarks.some((bookmark) => roomBookmarkKey(bookmark) === roomBookmarkKey(room));
  if (existing) {
    setStatus(`${roomNetworkLabel(room.network)} ${room.channel} is already bookmarked.`);
    return;
  }
  roomBookmarks = addRoomBookmark(roomBookmarks, room);
  saveRoomBookmarks();
  renderRoomBookmarks();
  updateControls();
  setStatus(`${roomNetworkLabel(room.network)} ${room.channel} was added to your Room menu.`);
}

function createPanelCanvas(label: string): { card: HTMLElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; ratio: number } {
  const card = document.createElement("article");
  card.className = "panel-card authentic-panel";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
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

function panelContentSignature(layout: PanelLayout): string {
  const content = JSON.stringify({
    balloons: layout.balloons.map(({ mode, speakerId, text }) => [mode, speakerId, text]),
    bodies: layout.bodies.map(({ id, poseRef, listener }) => [id, String(poseRef ?? ""), listener]),
  });
  return `panel:${content}`;
}

function workshopCharacterSelect(line: ConversationLine, index: number): HTMLSelectElement {
  const select = characterSelect.cloneNode(true) as HTMLSelectElement;
  select.removeAttribute("id");
  select.value = line.characterFile;
  select.setAttribute("aria-label", `Character for line ${index + 1}`);
  select.title = "Character";
  if (!select.value) {
    select.append(new Option(`${line.characterName} — current`, line.characterFile));
    select.value = line.characterFile;
  }
  return select;
}

function workshopModeSelect(line: ConversationLine, index: number): HTMLSelectElement {
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Balloon style for line ${index + 1}`);
  select.title = "Balloon style";
  select.append(
    new Option("Say", "say"),
    new Option("Think", "think"),
    new Option("Whisper", "whisper"),
    new Option("Action / narration", "action"),
  );
  select.value = line.mode;
  return select;
}

function appendStudioPoseOptions(select: HTMLSelectElement): void {
  select.replaceChildren(...STUDIO_POSES.map(({ id, label }) => new Option(label, id)));
}

function workshopPoseSelect(line: ConversationLine, index: number): HTMLSelectElement {
  const select = document.createElement("select");
  appendStudioPoseOptions(select);
  select.value = line.studioPose ?? "auto";
  select.setAttribute("aria-label", `Pose for line ${index + 1}`);
  select.title = "Expression or gesture";
  return select;
}

function selectedWorkshopCharacterName(): string {
  return workshopAddCharacter.selectedOptions[0]?.textContent?.split(" —")[0].trim() || "Character";
}

function updateWorkshopTextCount(textarea: HTMLTextAreaElement, output: HTMLOutputElement): void {
  const maximum = textarea.maxLength > 0 ? textarea.maxLength : 180;
  const length = textarea.value.length;
  output.value = `${length} / ${maximum}`;
  output.classList.toggle("near-limit", maximum - length <= 20);
}

function linePlacement(line: ConversationLine): StudioPlacement {
  if (line.breakBefore) return "new";
  if (line.stayInPanel) return "current";
  return "auto";
}

function applyLinePlacement(line: ConversationLine, placement: StudioPlacement): void {
  line.breakBefore = placement === "new";
  line.stayInPanel = placement === "current";
}

function updateWorkshopAddActions(): void {
  const currentPanelNumber = workshopPanelSummaries.length;
  const currentPanel = workshopPanelSummaries.at(-1);
  const currentPanelIsBlank = Boolean(currentPanel && currentPanel.characters.length === 0 && currentPanel.balloons.length === 0);
  const currentOption = workshopAddPlacement.querySelector<HTMLOptionElement>('option[value="current"]');
  if (currentOption) {
    currentOption.textContent = currentPanelIsBlank
      ? `Panel ${currentPanelNumber} is intentionally empty (starts Panel ${currentPanelNumber + 1})`
      : currentPanelNumber > 0
        ? `Add to current Panel ${currentPanelNumber} (if it fits)`
      : "No current panel yet (creates Panel 1)";
  }
  const destination = workshopAddPlacement.value === "new"
    ? "new panel"
    : workshopAddPlacement.value === "current"
      ? currentPanelIsBlank
        ? `new panel after empty Panel ${currentPanelNumber}`
        : currentPanelNumber > 0 ? `current Panel ${currentPanelNumber}` : "create Panel 1"
      : "automatic placement";
  workshopAddSpeakingButton.textContent = `Add speaking character → ${destination}`;
  workshopAddSilentButton.textContent = `Add silent character → ${destination}`;
}

function cloneStudioLine(line: ConversationLine): ConversationLine {
  return {
    ...line,
    links: line.links.map((link) => ({ ...link })),
    talkTo: [...line.talkTo],
  };
}

function captureStudioSnapshot(): StudioSnapshot {
  return {
    title: comicTitleOverride,
    backgroundFile: backdropSelect.value,
    fontId: comicFontId,
    lines: conversation.map(cloneStudioLine),
  };
}

function updateStudioHistoryControls(): void {
  workshopUndoButton.disabled = Boolean(activeWorkshopDraftRow) || studioUndoHistory.length === 0;
  workshopRedoButton.disabled = Boolean(activeWorkshopDraftRow) || studioRedoHistory.length === 0;
  workshopUndoButton.title = studioUndoHistory.length ? `Undo (${studioUndoHistory.length} available)` : "Nothing to undo";
  workshopRedoButton.title = studioRedoHistory.length ? `Redo (${studioRedoHistory.length} available)` : "Nothing to redo";
}

function recordStudioEdit(): void {
  studioUndoHistory.push(captureStudioSnapshot());
  if (studioUndoHistory.length > 50) studioUndoHistory.shift();
  studioRedoHistory.length = 0;
  updateStudioHistoryControls();
  queueStudioAutosave();
}

function resetStudioHistory(): void {
  studioUndoHistory.length = 0;
  studioRedoHistory.length = 0;
  updateStudioHistoryControls();
}

async function restoreStudioSnapshot(snapshot: StudioSnapshot, message: string): Promise<void> {
  setWorkshopBusy(true);
  try {
    conversation.splice(0, conversation.length, ...snapshot.lines.map(cloneStudioLine));
    comicTitleOverride = snapshot.title;
    comicFontId = snapshot.fontId;
    balloonFontSelect.value = comicFontId;
    workshopFont.value = comicFontId;
    const font = comicFontOption(comicFontId);
    balloonFontSelect.style.fontFamily = font.family;
    workshopFont.style.fontFamily = font.family;
    try {
      localStorage.setItem("comic-chat-balloon-font", comicFontId);
    } catch {}
    const backgroundChanged = backdropSelect.value !== snapshot.backgroundFile;
    backdropSelect.value = snapshot.backgroundFile;
    workshopBackground.value = snapshot.backgroundFile;
    if (backgroundChanged) await loadBackdrop();
    else await renderStrip();
    prepareWorkshopAddForm(true);
    renderStripWorkshop();
    persistStudioAutosave();
    setStatus(message);
  } finally {
    setWorkshopBusy(false);
    updateStudioHistoryControls();
  }
}

async function undoStudioEdit(): Promise<void> {
  const snapshot = studioUndoHistory.pop();
  if (!snapshot) return;
  studioRedoHistory.push(captureStudioSnapshot());
  await restoreStudioSnapshot(snapshot, "Undid the last Studio edit.");
}

async function redoStudioEdit(): Promise<void> {
  const snapshot = studioRedoHistory.pop();
  if (!snapshot) return;
  studioUndoHistory.push(captureStudioSnapshot());
  await restoreStudioSnapshot(snapshot, "Redid the Studio edit.");
}

function downloadableStudioLine(line: ConversationLine): StudioProjectLine {
  if (line.blankPanel) return { kind: "blank" };
  const characterId = studioCharacterIdByFile.get(line.characterFile);
  if (!characterId) {
    throw new Error(`${line.characterName} uses a temporary or hosted character. Choose a built-in character before saving an editable project.`);
  }
  return {
    kind: "character",
    characterId,
    characterName: line.characterName,
    message: line.message,
    mode: line.mode,
    placement: linePlacement(line),
    reaction: Boolean(line.reaction),
    studioPose: line.studioPose ?? "auto",
    talkTo: [...line.talkTo],
  };
}

function currentStudioProject(): StudioProject {
  const backgroundId = studioBackdropIdByFile.get(backdropSelect.value);
  if (!backgroundId) throw new Error("Choose a built-in Studio scene before saving an editable project");
  return createStudioProject(
    comicTitleOverride,
    backgroundId,
    comicFontId,
    conversation.map(downloadableStudioLine),
  );
}

function readStudioAutosave(): StudioProject | undefined {
  try {
    const source = localStorage.getItem(STUDIO_AUTOSAVE_KEY);
    return source ? parseStudioProject(source) : undefined;
  } catch {
    return undefined;
  }
}

function refreshStudioAutosaveButton(): void {
  const project = readStudioAutosave();
  workshopRecoverProjectButton.disabled = !project || project.lines.length === 0;
  if (!project || project.lines.length === 0) {
    workshopRecoverProjectButton.title = "No browser recovery draft is available";
    return;
  }
  let saved = "an earlier session";
  try {
    const value = localStorage.getItem(STUDIO_AUTOSAVE_TIME_KEY);
    const date = value ? new Date(value) : undefined;
    if (date && !Number.isNaN(date.valueOf())) saved = date.toLocaleString();
  } catch {}
  workshopRecoverProjectButton.title = `Recover ${project.lines.length} ${project.lines.length === 1 ? "beat" : "beats"} saved ${saved}`;
}

function clearStudioAutosave(): void {
  try {
    localStorage.removeItem(STUDIO_AUTOSAVE_KEY);
    localStorage.removeItem(STUDIO_AUTOSAVE_TIME_KEY);
  } catch {}
  refreshStudioAutosaveButton();
}

function persistStudioAutosave(): void {
  if (conversation.length === 0) {
    clearStudioAutosave();
    return;
  }
  try {
    localStorage.setItem(STUDIO_AUTOSAVE_KEY, studioProjectJson(currentStudioProject()));
    localStorage.setItem(STUDIO_AUTOSAVE_TIME_KEY, new Date().toISOString());
    refreshStudioAutosaveButton();
  } catch {
    // Temporary and hosted characters cannot be represented by the portable
    // project format. Keep the last recoverable draft instead of erasing it.
    refreshStudioAutosaveButton();
    workshopRecoverProjectButton.title += ". Current changes use a non-portable character, so browser recovery is paused";
  }
}

function queueStudioAutosave(): void {
  if (studioAutosaveQueued) return;
  studioAutosaveQueued = true;
  queueMicrotask(() => {
    studioAutosaveQueued = false;
    persistStudioAutosave();
  });
}

function studioProjectFilename(title: string): string {
  const slug = title.trim().toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  return `${slug || "webcomicchat-comic"}.wcc.json`;
}

async function newStudioProject(): Promise<void> {
  if (conversation.length > 0 && !window.confirm("Start a new blank Studio project and discard the current comic?")) return;
  conversation.length = 0;
  comicTitleOverride = "";
  forceNextPanel = false;
  workshopComicTitle.value = "";
  await renderStrip();
  prepareWorkshopAddForm(true);
  renderStripWorkshop();
  resetStudioHistory();
  clearStudioAutosave();
  setStatus("New blank Studio project ready. Scene and font choices were kept.");
}

function saveStudioProject(): void {
  const project = currentStudioProject();
  const url = URL.createObjectURL(new Blob([studioProjectJson(project)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = studioProjectFilename(comicTitleOverride);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  setStatus(`Editable Studio project saved with ${project.lines.length} ${project.lines.length === 1 ? "beat" : "beats"}.`);
}

async function openStudioProject(file: File): Promise<boolean> {
  if (file.size > 512 * 1024) throw new Error("Studio project files must be 512 KB or smaller");
  const project = parseStudioProject(await file.text());
  if (conversation.length > 0 && !window.confirm("Replace the current comic with this Studio project?")) return false;
  setWorkshopBusy(true);
  try {
    const backgroundFile = studioBackdropFileById.get(project.backgroundId);
    if (!backgroundFile) throw new Error("This project uses a scene that is not available in this version");
    if (!COMIC_FONT_OPTIONS.some((option) => option.id === project.fontId)) {
      throw new Error("This project uses a balloon font that is not available in this version");
    }
    const nextConversation: ConversationLine[] = [];
    for (const [index, saved] of project.lines.entries()) {
      if (saved.kind === "blank") {
        const blank = await createConversationLine(characters[0].file, "", "", "say", [], false, "neutral");
        blank.blankPanel = true;
        blank.breakBefore = true;
        blank.reaction = true;
        nextConversation.push(blank);
        continue;
      }
      const characterFile = studioCharacterFileById.get(saved.characterId);
      if (!characterFile) throw new Error(`Character beat ${index + 1} uses a character that is not available in this version`);
      const unsafeLink = blockedMessageLink(saved.message);
      if (unsafeLink && saved.mode !== "whisper") throw new Error(blockedLinkMessage(unsafeLink));
      const line = await createConversationLine(
        characterFile,
        saved.message,
        saved.characterName,
        saved.mode,
        saved.talkTo,
        saved.mode !== "whisper",
        saved.studioPose,
      );
      applyLinePlacement(line, saved.placement);
      line.reaction = saved.reaction;
      nextConversation.push(line);
    }
    conversation.splice(0, conversation.length, ...nextConversation);
    comicTitleOverride = project.title;
    backdropSelect.value = backgroundFile;
    workshopBackground.value = backgroundFile;
    comicFontId = project.fontId as ComicFontId;
    balloonFontSelect.value = comicFontId;
    workshopFont.value = comicFontId;
    balloonFontSelect.style.fontFamily = comicFontOption(comicFontId).family;
    workshopFont.style.fontFamily = comicFontOption(comicFontId).family;
    await loadBackdrop();
    prepareWorkshopAddForm(true);
    renderStripWorkshop();
    resetStudioHistory();
    persistStudioAutosave();
    setStatus(`Opened ${file.name}: ${project.lines.length} editable ${project.lines.length === 1 ? "beat" : "beats"}.`);
    return true;
  } finally {
    setWorkshopBusy(false);
  }
}

async function recoverStudioAutosave(): Promise<void> {
  let source: string | null = null;
  try {
    source = localStorage.getItem(STUDIO_AUTOSAVE_KEY);
  } catch {}
  if (!source) throw new Error("No browser recovery draft is available");
  const recovered = await openStudioProject(new File([source], "browser recovery draft.wcc.json", { type: "application/json" }));
  if (recovered) setStatus("Recovered the browser-local Studio draft. It has not been sent anywhere.");
}

function prepareWorkshopAddForm(resetCharacter = false): void {
  const previous = resetCharacter ? characterSelect.value : workshopAddCharacter.value;
  workshopAddCharacter.replaceChildren(...[...characterSelect.children].map((child) => child.cloneNode(true)));
  workshopAddCharacter.value = previous;
  if (!workshopAddCharacter.value) workshopAddCharacter.selectedIndex = 0;
  if (resetCharacter || !workshopAddName.value.trim()) workshopAddName.value = selectedWorkshopCharacterName();
  if (workshopAddPose.options.length === 0) appendStudioPoseOptions(workshopAddPose);
  updateWorkshopAddActions();
  updateWorkshopTextCount(workshopAddMessage, workshopAddCount);
  void updateWorkshopPosePreview().catch(showError);
}

async function addWorkshopBeat(silent: boolean): Promise<void> {
  const message = silent ? "" : workshopAddMessage.value.trim();
  if (!silent && !message) throw new Error("Type some dialogue, or choose Add silent character");
  const mode = workshopAddMode.value as BalloonMode;
  const unsafeLink = blockedMessageLink(message);
  if (unsafeLink && mode !== "whisper") throw new Error(blockedLinkMessage(unsafeLink));
  setWorkshopBusy(true);
  try {
    const line = await createConversationLine(
      workshopAddCharacter.value,
      message,
      workshopAddName.value.trim() || undefined,
      mode,
      [],
      mode !== "whisper",
      workshopAddPose.value as StudioPoseId,
    );
    applyLinePlacement(line, workshopAddPlacement.value as StudioPlacement);
    line.reaction = silent;
    recordStudioEdit();
    conversation.push(line);
    await renderStrip();
    workshopAddMessage.value = "";
    updateWorkshopTextCount(workshopAddMessage, workshopAddCount);
    renderStripWorkshop();
    scheduleWorkshopPosePreview();
    setStatus(silent
      ? `${line.characterName} was added silently. Check “What is in each panel” to see the final placement.`
      : `${line.characterName}'s line was added. Check “What is in each panel” to see the final placement.`);
  } finally {
    setWorkshopBusy(false);
  }
}

async function addWorkshopBlankPanel(): Promise<void> {
  setWorkshopBusy(true);
  try {
    // Keep a structurally valid internal beat so the existing history and
    // sequence tools can move/duplicate it. Rendering intentionally ignores
    // every character field when blankPanel is set.
    const line = await createConversationLine(characters[0].file, "", "", "say", [], false, "neutral");
    line.blankPanel = true;
    line.breakBefore = true;
    line.reaction = true;
    recordStudioEdit();
    conversation.push(line);
    await renderStrip();
    renderStripWorkshop();
    setStatus("Added an empty backdrop-only panel. Use the sequence tools below to move or duplicate it.");
  } finally {
    setWorkshopBusy(false);
  }
}

function setWorkshopBusy(busy: boolean): void {
  for (const control of stripWorkshopDialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input, select, textarea, button")) {
    if (control.closest("header") || control.value === "cancel") continue;
    if (busy) {
      if (!control.disabled) {
        control.disabled = true;
        control.dataset.workshopBusyDisabled = "1";
      }
    } else if (control.dataset.workshopBusyDisabled === "1") {
      control.disabled = false;
      delete control.dataset.workshopBusyDisabled;
    }
  }
}

function markWorkshopLineDraft(row: HTMLElement, applyButton: HTMLButtonElement, index: number): void {
  if (activeWorkshopDraftRow === row) return;
  activeWorkshopDraftRow = row;
  row.classList.add("workshop-line-dirty");
  applyButton.textContent = "Apply changes";
  applyButton.title = `Apply the draft changes to beat ${index + 1}`;
  const sequenceLabel = row.querySelector<HTMLElement>(".workshop-sequence span");
  if (sequenceLabel) sequenceLabel.textContent = "UNAPPLIED";
  for (const control of stripWorkshopDialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input, select, textarea, button")) {
    if (control.value === "cancel" || (row.contains(control) && (!(control instanceof HTMLButtonElement) || control === applyButton))) continue;
    if (!control.disabled) {
      control.disabled = true;
      control.dataset.workshopDraftDisabled = "1";
    }
  }
  setStatus(`Beat ${index + 1} has unapplied edits. Choose Apply changes before continuing elsewhere.`);
}

function clearWorkshopDraftLock(): void {
  activeWorkshopDraftRow = undefined;
  for (const control of stripWorkshopDialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("[data-workshop-draft-disabled='1']")) {
    control.disabled = false;
    delete control.dataset.workshopDraftDisabled;
  }
}

async function applyWorkshopLine(
  index: number,
  row: HTMLElement,
  character: HTMLSelectElement,
  name: HTMLInputElement,
  mode: HTMLSelectElement,
  pose: HTMLSelectElement,
  message: HTMLTextAreaElement,
  placement: HTMLSelectElement,
  reaction: HTMLInputElement,
): Promise<void> {
  const current = conversation[index];
  if (!current) return;
  const text = reaction.checked ? "" : message.value.trim();
  if (!reaction.checked && !text) throw new Error("Give this line some dialogue, or mark it as a silent reaction");
  const unsafeLink = blockedMessageLink(text);
  if (unsafeLink && mode.value !== "whisper") throw new Error(blockedLinkMessage(unsafeLink));
  setWorkshopBusy(true);
  row.classList.add("workshop-line-saving");
  try {
    const next = await createConversationLine(
      character.value,
      text,
      name.value.trim() || undefined,
      mode.value as BalloonMode,
      current.talkTo,
      mode.value !== "whisper",
      pose.value as StudioPoseId,
    );
    applyLinePlacement(next, placement.value as StudioPlacement);
    next.reaction = reaction.checked;
    recordStudioEdit();
    conversation[index] = next;
    await renderStrip();
    renderStripWorkshop();
    setStatus(`Workshop applied line ${index + 1}. The strip was reflowed locally.`);
  } finally {
    setWorkshopBusy(false);
  }
}

function renderStripWorkshop(): void {
  clearWorkshopDraftLock();
  workshopComicTitle.value = comicTitleOverride;
  updateWorkshopAddActions();
  updateStudioHistoryControls();
  workshopExportComicButton.disabled = panelCanvases.length === 0;
  const comicPanels = Math.max(0, panelCanvases.length - 1);
  workshopSummary.value = `${conversation.length} ${conversation.length === 1 ? "beat" : "beats"} · ${comicPanels} ${comicPanels === 1 ? "comic panel" : "comic panels"}`;
  workshopPanelMap.replaceChildren();
  if (workshopPanelSummaries.length === 0) {
    const emptyPlan = document.createElement("p");
    emptyPlan.className = "workshop-panel-map-empty";
    emptyPlan.textContent = "No comic panels yet. Add a character above to create the first one.";
    workshopPanelMap.append(emptyPlan);
  } else {
    workshopPanelSummaries.forEach((panel, index) => {
      const card = document.createElement("article");
      card.className = "workshop-panel-summary";
      if (index === workshopPanelSummaries.length - 1) card.classList.add("current-panel");
      const heading = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = `Panel ${index + 1}`;
      const current = document.createElement("span");
      current.textContent = index === workshopPanelSummaries.length - 1 ? "CURRENT PANEL" : "";
      heading.append(title, current);
      const sourceCanvas = panelCanvases[index + 1];
      const preview = document.createElement("canvas");
      preview.className = "workshop-panel-preview";
      preview.setAttribute("role", "img");
      preview.setAttribute("aria-label", `Preview of Panel ${index + 1}`);
      if (sourceCanvas) {
        const previewWidth = 208;
        preview.width = previewWidth;
        preview.height = Math.max(1, Math.round(previewWidth * sourceCanvas.height / sourceCanvas.width));
        preview.getContext("2d")?.drawImage(sourceCanvas, 0, 0, preview.width, preview.height);
      }
      const cast = document.createElement("p");
      cast.className = "workshop-panel-cast";
      cast.textContent = panel.characters.length
        ? `Characters: ${panel.characters.map(({ name, silent }) => `${name}${silent ? " (silent)" : ""}`).join(", ")}`
        : "Characters: none";
      const dialogue = document.createElement("ul");
      for (const balloon of panel.balloons) {
        const line = document.createElement("li");
        const text = balloon.text.length > 80 ? `${balloon.text.slice(0, 79)}…` : balloon.text;
        line.textContent = `${balloon.speaker}: “${text}”`;
        dialogue.append(line);
      }
      if (dialogue.childElementCount === 0) {
        const silent = document.createElement("p");
        silent.className = "workshop-panel-silent";
        silent.textContent = panel.characters.length === 0
          ? "Empty pacing panel—backdrop only."
          : "No balloons—posed characters only.";
        card.append(heading, preview, cast, silent);
      } else {
        card.append(heading, preview, cast, dialogue);
      }
      workshopPanelMap.append(card);
    });
  }
  workshopLines.replaceChildren();
  if (conversation.length === 0) {
    const empty = document.createElement("div");
    empty.className = "workshop-empty";
    empty.innerHTML = "<strong>The script track is empty.</strong><span>Use Add a character beat above to place the first character in Panel 1.</span>";
    workshopLines.append(empty);
    return;
  }

  conversation.forEach((line, index) => {
    const row = document.createElement("article");
    row.className = "workshop-line";
    if (line.breakBefore) row.classList.add("starts-panel");
    else if (line.stayInPanel) row.classList.add("joins-panel");

    if (line.blankPanel) {
      row.classList.add("blank-panel", "starts-panel");
      const sequence = document.createElement("div");
      sequence.className = "workshop-sequence";
      const number = document.createElement("strong");
      number.textContent = String(index + 1).padStart(2, "0");
      const beat = document.createElement("span");
      beat.textContent = "EMPTY PANEL";
      sequence.append(number, beat);

      const description = document.createElement("div");
      description.className = "workshop-blank-description";
      description.innerHTML = "<strong>Backdrop-only pacing panel</strong><span>No characters, dialogue, or balloons. The current Studio scene fills the panel.</span>";

      const tools = document.createElement("div");
      tools.className = "workshop-line-tools";
      const earlier = document.createElement("button");
      earlier.type = "button";
      earlier.textContent = "↑ Earlier";
      earlier.disabled = index === 0;
      earlier.addEventListener("click", () => {
        recordStudioEdit();
        const [moved] = conversation.splice(index, 1);
        conversation.splice(index - 1, 0, moved);
        void renderStrip().then(renderStripWorkshop).catch(showError);
      });
      const later = document.createElement("button");
      later.type = "button";
      later.textContent = "↓ Later";
      later.disabled = index === conversation.length - 1;
      later.addEventListener("click", () => {
        recordStudioEdit();
        const [moved] = conversation.splice(index, 1);
        conversation.splice(index + 1, 0, moved);
        void renderStrip().then(renderStripWorkshop).catch(showError);
      });
      const duplicate = document.createElement("button");
      duplicate.type = "button";
      duplicate.textContent = "Duplicate";
      duplicate.addEventListener("click", () => {
        recordStudioEdit();
        conversation.splice(index + 1, 0, cloneStudioLine(line));
        void renderStrip().then(renderStripWorkshop).catch(showError);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        recordStudioEdit();
        conversation.splice(index, 1);
        void renderStrip().then(renderStripWorkshop).catch(showError);
      });
      tools.append(earlier, later, duplicate, remove);
      row.append(sequence, description, tools);
      workshopLines.append(row);
      return;
    }

    const sequence = document.createElement("div");
    sequence.className = "workshop-sequence";
    const number = document.createElement("strong");
    number.textContent = String(index + 1).padStart(2, "0");
    const beat = document.createElement("span");
    beat.textContent = line.breakBefore ? "NEW PANEL" : line.stayInPanel ? "TRY CURRENT" : "AUTO";
    sequence.append(number, beat);

    const script = document.createElement("div");
    script.className = "workshop-script";
    const cast = workshopCharacterSelect(line, index);
    const name = document.createElement("input");
    name.value = line.characterName;
    name.maxLength = 32;
    name.placeholder = "Display name";
    name.setAttribute("aria-label", `Display name for line ${index + 1}`);
    name.title = "Display name";
    const mode = workshopModeSelect(line, index);
    const pose = workshopPoseSelect(line, index);
    const message = document.createElement("textarea");
    message.rows = 2;
    message.maxLength = 180;
    message.value = line.message;
    message.placeholder = line.reaction ? "Silent reaction" : "Dialogue";
    message.setAttribute("aria-label", `Text for line ${index + 1}`);
    const messageField = document.createElement("div");
    messageField.className = "workshop-line-dialogue";
    const messageCount = document.createElement("output");
    messageCount.setAttribute("aria-label", `Character count for line ${index + 1}`);
    updateWorkshopTextCount(message, messageCount);
    messageField.append(message, messageCount);
    const staging = document.createElement("div");
    staging.className = "workshop-staging";
    const placementLabel = document.createElement("label");
    placementLabel.append("Placement ");
    const placement = document.createElement("select");
    placement.setAttribute("aria-label", `Panel placement for line ${index + 1}`);
    placement.append(
      new Option("New panel", "new"),
      new Option("Current panel if it fits", "current"),
      new Option("Automatic", "auto"),
    );
    placement.value = linePlacement(line);
    placementLabel.append(placement);
    const reactionLabel = document.createElement("label");
    const reaction = document.createElement("input");
    reaction.type = "checkbox";
    reaction.checked = Boolean(line.reaction);
    reactionLabel.append(reaction, " Silent reaction");
    reaction.addEventListener("change", () => {
      message.disabled = reaction.checked;
      message.placeholder = reaction.checked ? "Character appears without a balloon" : "Dialogue";
    });
    message.disabled = reaction.checked;
    staging.append(placementLabel, reactionLabel);
    script.append(cast, name, mode, pose, messageField, staging);

    const tools = document.createElement("div");
    tools.className = "workshop-line-tools";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "workshop-apply";
    apply.textContent = "Apply";
    apply.addEventListener("click", () => {
      void applyWorkshopLine(index, row, cast, name, mode, pose, message, placement, reaction).catch(showError);
    });
    for (const control of [cast, mode, pose, placement, reaction]) {
      control.addEventListener("change", () => markWorkshopLineDraft(row, apply, index));
    }
    for (const control of [name, message]) {
      control.addEventListener("input", () => markWorkshopLineDraft(row, apply, index));
    }
    message.addEventListener("input", () => updateWorkshopTextCount(message, messageCount));
    const earlier = document.createElement("button");
    earlier.type = "button";
    earlier.textContent = "↑ Earlier";
    earlier.disabled = index === 0;
    earlier.addEventListener("click", () => {
      recordStudioEdit();
      const [moved] = conversation.splice(index, 1);
      conversation.splice(index - 1, 0, moved);
      void renderStrip().then(renderStripWorkshop).catch(showError);
    });
    const later = document.createElement("button");
    later.type = "button";
    later.textContent = "↓ Later";
    later.disabled = index === conversation.length - 1;
    later.addEventListener("click", () => {
      recordStudioEdit();
      const [moved] = conversation.splice(index, 1);
      conversation.splice(index + 1, 0, moved);
      void renderStrip().then(renderStripWorkshop).catch(showError);
    });
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.textContent = "Duplicate";
    duplicate.addEventListener("click", () => {
      recordStudioEdit();
      conversation.splice(index + 1, 0, { ...line, talkTo: [...line.talkTo], links: [...line.links] });
      void renderStrip().then(renderStripWorkshop).catch(showError);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      recordStudioEdit();
      conversation.splice(index, 1);
      void renderStrip().then(renderStripWorkshop).catch(showError);
    });
    tools.append(apply, earlier, later, duplicate, remove);
    row.append(sequence, script, tools);
    workshopLines.append(row);
  });
}

function showStripWorkshop(): void {
  prepareWorkshopAddForm(true);
  workshopBackground.value = backdropSelect.value;
  workshopFont.value = comicFontId;
  workshopFont.style.fontFamily = comicFontOption(comicFontId).family;
  resetStudioHistory();
  refreshStudioAutosaveButton();
  renderStripWorkshop();
  stripWorkshopDialog.showModal();
}

async function disconnectAndOpenBlankStudio(): Promise<void> {
  // Invalidate remote avatar/message work before disconnecting so a slow
  // decode from the old room cannot repopulate the newly blank Studio comic.
  liveComicGeneration++;
  liveClient.disconnect();
  pendingLiveLines.length = 0;
  knownMembers.clear();
  selectedAddressees.clear();
  announcedAvatars.clear();
  publicRooms.clear();
  totalPublicRooms = 0;
  roomDirectoryLoaded = false;
  conversation.length = 0;
  comicTitleOverride = "";
  forceNextPanel = false;
  panelSelectionMode = false;
  selectedPanelKeys.clear();
  renderMembers();
  renderAvatarRules();
  await renderStrip();
  showStripWorkshop();
  setStatus("Disconnected from live chat. Offline Comic Studio opened with a blank project.");
}

// ---------------------------------------------------------------------------
// Comic Generator (/generation): a private page that turns an AI assistant's
// JSON script into a Studio project. See generation-script.ts.

const onGenerationPage = /^\/generation\/?$/u.test(window.location.pathname);
const GENERATOR_DRAFT_KEY = "webcomicchat.generation.draft";

/** Friendly names for what the Studio can draw: "Anna", "Anna (color)", "Bolo (art pack)". */
function generationCatalog(): GenerationCatalog {
  const named = <T extends { name: string; id: string }>(items: T[]): T[] => {
    const seen = new Map<string, number>();
    return items.map((item) => {
      const count = (seen.get(item.name.toLocaleLowerCase()) ?? 0) + 1;
      seen.set(item.name.toLocaleLowerCase(), count);
      return count === 1 ? item : { ...item, name: `${item.name} ${count}` };
    });
  };
  const characterName = (label: string) => {
    const [base, edition = ""] = label.split(" — ");
    if (/color/iu.test(edition)) return `${base} (color)`;
    if (/art pack edition/iu.test(edition)) return `${base} (art pack)`;
    return base;
  };
  return {
    characters: named(characters.flatMap(({ file, label }) => {
      const id = studioCharacterIdByFile.get(file);
      return id ? [{ name: characterName(label), id }] : [];
    })),
    backgrounds: named(backdrops.flatMap(({ file, label }) => {
      const id = studioBackdropIdByFile.get(file);
      return id ? [{ name: label.split(" — ")[0], id }] : [];
    })),
    fonts: COMIC_FONT_OPTIONS.map(({ id, label }) => ({ name: label.replace(/\s*\(.*\)$/u, ""), id })),
  };
}

function showGeneratorProblems(errors: readonly string[], warnings: readonly string[]): void {
  const item = (text: string) => Object.assign(document.createElement("li"), { textContent: text });
  generatorErrors.replaceChildren(...errors.map(item));
  generatorWarnings.replaceChildren(...warnings.map(item));
  generatorProblemsTitle.textContent = errors.length ? "Fix these, then try again" : "Made the comic, with notes";
  generatorProblems.hidden = errors.length === 0 && warnings.length === 0;
}

function openGenerator(): void {
  generatorBrief.textContent = generationBrief(generationCatalog());
  if (!generatorScript.value) {
    try { generatorScript.value = localStorage.getItem(GENERATOR_DRAFT_KEY) ?? ""; } catch {}
  }
  if (!generatorDialog.open) generatorDialog.showModal();
}

async function makeGeneratedComic(): Promise<void> {
  try { localStorage.setItem(GENERATOR_DRAFT_KEY, generatorScript.value); } catch {}
  const result = convertGenerationScript(generatorScript.value, generationCatalog());
  showGeneratorProblems(result.errors, result.warnings);
  if (!result.project) return;
  const name = `${result.project.title || "generated-comic"}.wcc.json`;
  generatorDialog.close();
  showStripWorkshop();
  try {
    await openStudioProject(new File([JSON.stringify(result.project)], name, { type: "application/json" }));
  } catch (error) {
    stripWorkshopDialog.close();
    showGeneratorProblems([error instanceof Error ? error.message : String(error)], result.warnings);
    openGenerator();
  }
}

element<HTMLButtonElement>("#generator-copy-brief").addEventListener("click", () => {
  void copyText(generationBrief(generationCatalog())).then((copied) => {
    setStatus(copied ? "Instructions copied. Paste them into ChatGPT." : "Couldn't copy; open \"Show the instructions\" and copy them by hand.");
  });
});
element<HTMLButtonElement>("#generator-copy-errors").addEventListener("click", () => {
  const lines = [...generatorErrors.children, ...generatorWarnings.children].map((item) => `- ${item.textContent}`);
  void copyText(`The site couldn't use that script:\n${lines.join("\n")}\nPlease fix exactly these problems and reply with the whole corrected JSON.`);
});
element<HTMLButtonElement>("#generator-example").addEventListener("click", () => {
  const brief = generationBrief(generationCatalog());
  generatorScript.value = brief.slice(brief.indexOf("EXAMPLE\n") + 8, brief.lastIndexOf("}") + 1);
  showGeneratorProblems([], []);
});
element<HTMLButtonElement>("#generator-clear").addEventListener("click", () => {
  generatorScript.value = "";
  try { localStorage.removeItem(GENERATOR_DRAFT_KEY); } catch {}
  showGeneratorProblems([], []);
  generatorScript.focus();
  setStatus("Generator script cleared.");
});
element<HTMLButtonElement>("#generator-make").addEventListener("click", () => void makeGeneratedComic().catch(showError));
if (onGenerationPage) {
  document.title = "Comic Generator — Comic Chat";
  // generation/index.html already says this; repeat it for hosts that serve the main page here.
  if (!document.querySelector('meta[name="robots"]')) {
    document.head.append(Object.assign(document.createElement("meta"), { name: "robots", content: "noindex, nofollow, noarchive" }));
  }
  // Back to the generator whenever the Studio closes, to try another script.
  stripWorkshopDialog.addEventListener("close", () => openGenerator());
}

function openStripWorkshop(): void {
  if (!studioEntryNeedsDisconnect(liveState)) {
    showStripWorkshop();
    return;
  }
  const room = joinedChannel || channelInput.value || "the current IRC session";
  workshopLiveWarningDetail.textContent = `Continuing will disconnect from ${room}, clear the entire current comic (including all live panels), and open a blank Studio project. Cancel keeps the room and comic exactly as they are.`;
  workshopLiveWarningDialog.returnValue = "";
  workshopLiveWarningDialog.showModal();
}

function followNewestPanel(generation: number, previousScrollTop: number): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (generation !== renderGeneration) return;
      // A deliberate scroll during the redraw always wins over auto-follow.
      if (Math.abs(stage.scrollTop - previousScrollTop) > 2) return;
      stage.scrollTop = stage.scrollHeight;
    });
  });
}

function createEmptyStrip(): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "empty-strip";
  const number = document.createElement("span");
  number.textContent = "01";
  const heading = document.createElement("strong");
  const description = document.createElement("p");
  empty.append(number, heading, description);

  if (liveState === "offline" || liveState === "disconnected") {
    heading.textContent = "Chat live or make your own comic.";
    description.textContent = `Join ${DEFAULT_ROOM_SELECTION.channel} using any nickname—no account or signup required. Every message becomes a comic panel.`;

    const actions = document.createElement("div");
    actions.className = "empty-strip-actions";
    const join = document.createElement("button");
    join.type = "button";
    join.className = "empty-strip-primary";
    join.textContent = `Join ${DEFAULT_ROOM_SELECTION.channel}`;
    join.addEventListener("click", () => {
      networkSelect.value = DEFAULT_ROOM_SELECTION.network;
      channelInput.value = DEFAULT_ROOM_SELECTION.channel;
      updateControls();
      connectButton.click();
    });
    const studio = document.createElement("button");
    studio.type = "button";
    studio.textContent = "Open Comic Studio…";
    studio.addEventListener("click", openStripWorkshop);
    actions.append(join, studio);

    const note = document.createElement("small");
    note.textContent = "The online Comic Studio lets you write, stage, and edit a strip without joining chat. To chat elsewhere, enter another #channel above or browse channels.";
    empty.append(actions, note);
    return empty;
  }

  if (liveState === "joined") {
    const room = joinedChannel || channelInput.value || DEFAULT_ROOM_SELECTION.channel;
    heading.textContent = `You’re live in ${room}.`;
    description.textContent = "Write a message below to start the strip. WebComicChat will choose the pose and lay out the panel.";
    return empty;
  }

  if (liveState === "browsing") {
    heading.textContent = "Choose a chat room to begin.";
    description.textContent = "Pick a channel from the list, or type one above. Your first message there will start the strip.";
    return empty;
  }

  heading.textContent = liveState === "joining" ? `Joining ${channelInput.value || DEFAULT_ROOM_SELECTION.channel}…` : "Connecting to live chat…";
  description.textContent = "The first message after you join will start the strip.";
  return empty;
}

function refreshEmptyStrip(): void {
  if (!strip.querySelector(".empty-strip")) return;
  strip.replaceChildren(createEmptyStrip());
}

async function renderStrip(): Promise<void> {
  const generation = ++renderGeneration;
  const followLatest = shouldFollowLatest(stage);
  const nextCanvases: HTMLCanvasElement[] = [];
  const nextPanelKeys: string[] = [];
  const fragment = document.createDocumentFragment();
  const renderedConversation = visibleComicLines(conversation, hiddenComicBots).map(displayLineWithCensor);
  panelCanvases = [];
  panelKeys = [];
  updateControls();

  if (renderedConversation.length === 0) {
    fragment.append(createEmptyStrip());
    if (generation !== renderGeneration) return;
    strip.replaceChildren(fragment);
    panelCanvases = [];
    panelKeys = [];
    workshopPanelSummaries = [];
    selectedPanelKeys = reconcilePanelSelection(selectedPanelKeys, panelKeys);
    stripCount.textContent = "0 panels";
    updateControls();
    return;
  }

  const fontChoice = comicFontOption(comicFontId);
  if (fontChoice.comicMetrics) await comicFontsReady;
  const measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) throw new Error("Canvas is unavailable");
  const fonts = {
    normal: balloonFontMetrics(canvasMeasurer(measureContext, { fontFamily: fontChoice.family }), { comicSans: fontChoice.comicMetrics }),
    whisper: balloonFontMetrics(canvasMeasurer(measureContext, { italic: true, fontFamily: fontChoice.family }), { comicSans: fontChoice.comicMetrics }),
  };
  const castFiles = new Map<string, string>();
  for (const line of renderedConversation) {
    if (!line.blankPanel) castFiles.set(line.characterName, line.characterFile);
  }
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
  for (const line of renderedConversation) {
    if (line.blankPanel) continue;
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
  const title = comicTitleOverride || page.chooseTitle();
  for (const line of renderedConversation) {
    if (line.blankPanel) {
      page.addBlankPanel();
      continue;
    }
    currentTalkTo.set(line.characterName, line.talkTo);
    const image = images.get(line.poseRef)!;
    const comicLine: ComicLine = {
      speakerId: line.characterName,
      text: line.displayMessage,
      mode: line.mode,
      breakBefore: line.breakBefore,
      stayInPanel: line.stayInPanel,
      reaction: line.reaction,
      pose: { width: image.width, height: image.height, faceX: line.body.faceX },
      poseRef: line.poseRef,
      links: line.links.map(({ href, hostname, start, end }) => ({ href, hostname, start, end })),
    };
    page.addLine(comicLine);
  }

  const nextWorkshopPanelSummaries: WorkshopPanelSummary[] = page.layouts.map((layout) => {
    const speaking = new Set(layout.balloons.map((balloon) => balloon.speakerId));
    const characters = [...new Set(layout.bodies.map((body) => body.id))].map((name) => ({
      name,
      silent: !speaking.has(name),
    }));
    return {
      characters,
      balloons: layout.balloons.map((balloon) => ({ speaker: balloon.speakerId, text: balloon.text })),
    };
  });

  const uniqueCast = [...castFiles].map(([id, file], index) => ({
    id,
    nickname: id,
    sends: renderedConversation.filter((line) => line.characterName === id && !line.reaction).length,
    self: index === 0,
    file,
  }));
  const titleLayout = layoutTitlePanel(title, uniqueCast, {
    measure: (text, height) => {
      measureContext.font = `${height}px ${fontChoice.family}`;
      return measureContext.measureText(text).width;
    },
  });
  const titlePanel = createPanelCanvas(`Title: ${title}`);
  drawTitlePanel(titlePanel.context, titleLayout, (id) => icons.get(id), { scale: PANEL_SCALE, fontFamily: fontChoice.family });
  titlePanel.card.querySelector<HTMLElement>(".panel-meta")!.textContent = "Title and starring panel";
  titlePanel.card.dataset.panelKey = "title";
  fragment.append(titlePanel.card);
  nextCanvases.push(titlePanel.canvas);
  nextPanelKeys.push("title");

  const panelKeyOccurrences = new Map<string, number>();
  page.layouts.forEach((layout, index) => {
    const panel = createPanelCanvas(describePanel(index, layout.balloons, layout.bodies));
    drawPanel(panel.context, layout, {
      backdrop: backdropCanvas,
      body: (body) => images.get(String(body.poseRef)),
    }, { scale: PANEL_SCALE, fontFamily: fontChoice.family });
    addPanelLinkOverlays(panel.card, layout);
    panel.card.querySelector<HTMLElement>(".panel-meta")!.textContent = layout.bodies.length === 0 && layout.balloons.length === 0
      ? `Panel ${index + 1} · empty pacing panel`
      : `Panel ${index + 1} · ${layout.balloons.length} ${layout.balloons.length === 1 ? "balloon" : "balloons"}`;
    const panelKeyBase = panelContentSignature(layout);
    const occurrence = panelKeyOccurrences.get(panelKeyBase) ?? 0;
    panelKeyOccurrences.set(panelKeyBase, occurrence + 1);
    const panelKey = `${panelKeyBase}:${occurrence}`;
    panel.card.dataset.panelKey = panelKey;
    fragment.append(panel.card);
    nextCanvases.push(panel.canvas);
    nextPanelKeys.push(panelKey);
  });

  if (generation !== renderGeneration) return;
  const stillFollowing = followLatest && shouldFollowLatest(stage);
  const previousScrollTop = stage.scrollTop;
  strip.replaceChildren(fragment);
  renderTextView(renderedConversation);
  panelCanvases = nextCanvases;
  panelKeys = nextPanelKeys;
  workshopPanelSummaries = nextWorkshopPanelSummaries;
  selectedPanelKeys = reconcilePanelSelection(selectedPanelKeys, panelKeys);
  const count = page.layouts.length + 1;
  stripCount.textContent = `${count} ${count === 1 ? "panel" : "panels"} · ${renderedConversation.length} ${renderedConversation.length === 1 ? "beat" : "beats"}`;
  updateControls();
  if (stillFollowing) followNewestPanel(generation, previousScrollTop);
}

/** Plain text view: the same lines the comic draws, as an IRC client shows them. */
function renderTextView(lines: readonly ConversationLine[]): void {
  textView.hidden = !plainTextView;
  strip.hidden = plainTextView;
  if (!plainTextView) return;
  const stillFollowing = shouldFollowLatest(stage);
  textView.replaceChildren(...lines.map((line) => {
    const item = document.createElement("li");
    item.dataset.mode = line.mode;
    item.textContent = transcriptLine({ ...line, message: line.displayMessage });
    return item;
  }));
  if (stillFollowing) stage.scrollTop = stage.scrollHeight;
}

/** Screen readers hear each new line once, instead of the whole strip redrawing. */
function announceLine(line: ConversationLine): void {
  if (visibleComicLines([line], hiddenComicBots).length === 0) return;
  const shown = displayLineWithCensor(line);
  const item = document.createElement("p");
  item.textContent = transcriptLine({ ...shown, message: shown.displayMessage });
  chatAnnouncer.append(item);
  while (chatAnnouncer.childElementCount > 20) chatAnnouncer.firstElementChild?.remove();
}

function addPanelLinkOverlays(card: HTMLElement, layout: import("./layout/page").PanelLayout): void {
  const layer = document.createElement("div");
  layer.className = "panel-link-layer";
  for (const balloon of layout.balloons) {
    for (const link of balloon.links) {
      link.boxes.forEach((box, index) => {
        const anchor = document.createElement("a");
        anchor.className = "panel-link-hitbox";
        anchor.href = link.href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.title = link.href;
        anchor.setAttribute("aria-label", `Open ${link.hostname} in a new window`);
        if (index > 0) {
          anchor.tabIndex = -1;
          anchor.setAttribute("aria-hidden", "true");
        }
        anchor.style.left = `${box.left / layout.width * 100}%`;
        anchor.style.top = `${-box.top / layout.height * 100}%`;
        anchor.style.width = `${box.width / layout.width * 100}%`;
        anchor.style.height = `${box.height / layout.height * 100}%`;
        layer.append(anchor);
      });
    }
  }
  if (layer.childElementCount > 0) card.append(layer);
}

async function loadBackdrop(): Promise<void> {
  const currentGeneration = ++backdropGeneration;
  setStatus("Decoding backdrop…");
  const custom = sessionCustomBackdrops.get(backdropSelect.value);
  let bitmap: DecodedBitmap;
  if (custom) {
    bitmap = custom.bitmap;
  } else {
    const buffer = await fetchAsset(backdropSelect.value);
    const parsed = parseAvatar(buffer);
    if (parsed.type !== AvatarType.Backdrop || !parsed.backdrop) {
      throw new Error("This is not a Comic Chat backdrop");
    }
    bitmap = await decodeImage(buffer, parsed.backdrop, parsed.palette);
  }
  if (currentGeneration !== backdropGeneration) return;
  backdropBitmap = bitmap;
  backdropCanvas = bitmapCanvas(bitmap);
  await renderStrip();
  setStatus(`Scene changed · ${bitmap.width}×${bitmap.height}px ${custom ? "local background" : "original art"}`);
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
  const typed = messageInput.value.trim();
  if (!typed || isAdding) return;
  const command = parseSlashCommand(typed);
  if (command && command.kind !== "line" && command.kind !== "whisper") {
    runSlashCommand(command);
    return;
  }
  const message = command ? command.text : typed;
  if (message === "<Brk>") {
    forceNextPanel = true;
    messageInput.value = "";
    updateControls();
    setStatus("<Brk> armed: your next local comic entry will start a new panel. Nothing was sent to IRC.");
    return;
  }
  if (message === "<Chr>") {
    isAdding = true;
    updateControls();
    try {
      const line = await createConversationLine(characterSelect.value, "", nicknameInput.value.trim() || undefined, "say", [], false);
      line.reaction = true;
      line.breakBefore = forceNextPanel;
      forceNextPanel = false;
      appendConversationLine(line, false);
      messageInput.value = "";
      setStatus("<Chr> added a local reaction shot. Nothing was sent to IRC.");
    } finally {
      isAdding = false;
      updateControls();
    }
    return;
  }
  const unsafeLink = blockedMessageLink(message);
  if (unsafeLink) throw new Error(blockedLinkMessage(unsafeLink));
  isAdding = true;
  updateControls();
  setStatus("Reading the line and choosing a pose…");
  try {
    const mode = command?.kind === "whisper" ? "whisper" : command?.kind === "line" ? command.mode : messageMode.value as BalloonMode;
    const whisperTo = command?.kind === "whisper" ? whisperRecipients(command.to) : [...selectedAddressees];
    if (liveState === "joined" && mode === "whisper" && whisperTo.length === 0) {
      throw new Error("Select who to whisper to in the member list first");
    }
    if (liveState === "joined" && mode === "whisper" && whisperTo.length > 5) {
      throw new Error("Choose no more than five people for one whisper");
    }
    const line = await createConversationLine(characterSelect.value, message, nicknameInput.value.trim() || undefined, mode, whisperTo);
    line.breakBefore = forceNextPanel;
    forceNextPanel = false;
    if (liveState === "joined") {
      // Whispers go privately to each selected member; nobody else receives them.
      if (mode === "whisper") liveClient.whisper(whisperTo, message);
      // Say who the line is for with IRC's usual "Name:" prefix, so other
      // comics (and bots) know who you're talking to. Actions stay as they are.
      else liveClient.say(mode === "action" ? message : addressedText(message, whisperTo), mode === "action");
      const sentNote = mode === "whisper" ? ` · whispered to ${whisperTo.join(", ")}` : " · sent to IRC";
      pendingLiveLines.push({ line, sentNote });
      setStatus(`Sending ${line.mode === "whisper" ? "whisper" : "message"}…`);
    } else {
      appendConversationLine(line, false);
      setStatus(`${line.characterName}: ${line.expression} · ${line.mode} balloon`);
    }
    messageInput.value = "";
  } finally {
    isAdding = false;
    updateControls();
  }
}

/** "/whisper anna hi": match typed names to the room's members, keeping their spelling. */
function whisperRecipients(names: readonly string[]): string[] {
  if (liveState !== "joined") return [...names];
  return names.map((name) => {
    const member = [...knownMembers].find((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!member) throw new Error(`${name} isn't in this room`);
    return member;
  });
}

function runSlashCommand(command: ReturnType<typeof parseSlashCommand>): void {
  switch (command?.kind) {
    case "join":
      messageInput.value = "";
      channelInput.value = command.channel;
      updateControls();
      connectButton.click();
      break;
    case "clear":
      messageInput.value = "";
      clearButton.click();
      break;
    case "quit":
      messageInput.value = "";
      if (liveClient.active) disconnectButton.click();
      else setStatus("You're not connected.");
      break;
    case "help":
      messageInput.value = "";
      setStatus(SLASH_HELP);
      break;
    case "error":
      // Keep what was typed so it can be fixed; nothing is sent.
      showError(new Error(command.message));
      break;
  }
}

function downloadStrip(): void {
  const indexes = panelSelectionMode
    ? selectedPanelIndexes(panelKeys, selectedPanelKeys)
    : panelCanvases.map((_, index) => index);
  const exportCanvases = indexes.map((index) => panelCanvases[index]).filter(Boolean);
  if (exportCanvases.length === 0) return;
  const grid = stripExportGrid(exportCanvases.length, PANEL_PIXELS);
  const output = document.createElement("canvas");
  output.width = grid.width;
  output.height = grid.height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, output.width, output.height);
  exportCanvases.forEach((canvas, index) => {
    const { x, y } = grid.position(index);
    context.drawImage(canvas, x, y, PANEL_PIXELS, PANEL_PIXELS);
  });

  const link = document.createElement("a");
  link.download = `comic-chat-${panelSelectionMode ? "selection" : "strip"}-${Date.now()}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
  setStatus(panelSelectionMode
    ? `Saved ${exportCanvases.length} selected ${exportCanvases.length === 1 ? "panel" : "panels"} in comic order.`
    : `Saved the complete ${exportCanvases.length}-panel comic.`);
}

function setPanelSelectionMode(enabled: boolean): void {
  panelSelectionMode = enabled;
  selectedPanelKeys = new Set<string>();
  updateControls();
  if (enabled) {
    panelSelectionBar.scrollIntoView({ block: "nearest" });
    setStatus("Panel selection is on. Tap any title or comic panel to include it, then choose Save selected.");
  } else {
    setStatus("Panel selection closed. Save Comic will save the complete strip.");
  }
}

function toggleSelectedPanel(card: HTMLElement): void {
  const key = card.dataset.panelKey;
  if (!panelSelectionMode || !key) return;
  if (selectedPanelKeys.has(key)) selectedPanelKeys.delete(key);
  else selectedPanelKeys.add(key);
  updateControls();
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
importBackdropButton.addEventListener("click", () => backdropFileInput.click());
workshopImportBackdropButton.addEventListener("click", () => workshopBackdropFileInput.click());
function handleBackdropFileInput(input: HTMLInputElement): void {
  const file = input.files?.[0];
  input.value = "";
  if (file) void importLocalBackdrop(file).catch(showError);
}
backdropFileInput.addEventListener("change", () => handleBackdropFileInput(backdropFileInput));
workshopBackdropFileInput.addEventListener("change", () => handleBackdropFileInput(workshopBackdropFileInput));
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
      ? `You are now appearing as ${selectedAvatarDisplayName()}.`
      : "Your imported avatar is selected locally, but it cannot be shared until it has an approved webcomicchat.com URL.");
  }).catch(showError);
});
communityAvatarsButton.addEventListener("click", showCommunityAvatarGallery);
communityAvatarUploadOpen.addEventListener("click", () => {
  communityAvatarUploadStatus.textContent = "";
  communityAvatarUploadDialog.showModal();
});
communityAvatarUploadSubmit.addEventListener("click", () => {
  void publishCommunityAvatar().catch((error) => {
    communityAvatarUploadStatus.textContent = error instanceof Error ? error.message : "Upload failed";
  });
});
communityAvatarReportSubmit.addEventListener("click", () => {
  void submitCommunityAvatarReport().catch((error) => {
    communityAvatarReportStatus.textContent = error instanceof Error ? error.message : "Could not send report";
  });
});
importAvatarButton.addEventListener("click", () => avatarFileInput.click());
avatarFileInput.addEventListener("change", () => {
  const file = avatarFileInput.files?.[0];
  avatarFileInput.value = "";
  if (file) void importLocalAvatar(file).catch(showError);
});
createAvatarButton.addEventListener("click", () => {
  applyBuilderMode();
  avatarBuilderDialog.showModal();
  builderNameInput.focus();
});
builderNameInput.addEventListener("input", updateBuilderControls);
for (const input of builderModeInputs) input.addEventListener("change", applyBuilderMode);
for (const input of builderConstructionInputs) input.addEventListener("change", applyBuilderConstruction);
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
builderAddFacesButton.addEventListener("click", () => builderFaceFilesInput.click());
builderAddTorsosButton.addEventListener("click", () => builderTorsoFilesInput.click());
function handleBuilderPartFiles(input: HTMLInputElement, kind: "face" | "torso"): void {
  const files = [...(input.files ?? [])];
  input.value = "";
  if (files.length) void addBuilderPartFiles(kind, files).catch((error) => {
    setBuilderStatus(error instanceof Error ? error.message : `Could not read those ${kind} images`, true);
    updateBuilderControls();
  });
}
builderFaceFilesInput.addEventListener("change", () => handleBuilderPartFiles(builderFaceFilesInput, "face"));
builderTorsoFilesInput.addEventListener("change", () => handleBuilderPartFiles(builderTorsoFilesInput, "torso"));
builderClearButton.addEventListener("click", () => {
  if (compositeBuilderActive()) {
    builderFaces.length = 0;
    builderTorsos.length = 0;
    selectedBuilderFace = 0;
    selectedBuilderTorso = 0;
    renderBuilderParts();
    setBuilderStatus(compositeBuilderStatus());
  } else {
    builderPoses.length = 0;
    renderBuilderPoses();
    setBuilderStatus(builderMode() === "quick" ? quickBuilderStatus() : "Add at least one neutral pose.");
  }
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
balloonFontSelect.addEventListener("change", () => {
  comicFontId = parseComicFontId(balloonFontSelect.value);
  balloonFontSelect.value = comicFontId;
  try {
    localStorage.setItem("comic-chat-balloon-font", comicFontId);
  } catch {}
  const choice = comicFontOption(comicFontId);
  balloonFontSelect.style.fontFamily = choice.family;
  setStatus(`Balloon font changed to ${choice.label}. Reflowing the comic…`);
  void renderStrip()
    .then(() => setStatus(`Balloon font: ${choice.label}.`))
    .catch(showError);
});
const ResizeObserverConstructor = window.ResizeObserver as typeof ResizeObserver | undefined;
if (ResizeObserverConstructor) new ResizeObserverConstructor(updatePanelView).observe(stage);
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
  setStatus(removed
    ? removed.blankPanel ? "Removed the last empty panel." : `Removed ${removed.characterName}'s last line.`
    : "The strip is already empty.");
});
clearButton.addEventListener("click", () => {
  conversation.length = 0;
  comicTitleOverride = "";
  forceNextPanel = false;
  void renderStrip().catch(showError);
  setStatus("Strip cleared. Write a line to begin again.");
});
openStripWorkshopButton.addEventListener("click", openStripWorkshop);
workshopLiveWarningDialog.addEventListener("close", () => {
  if (workshopLiveWarningDialog.returnValue === "continue") {
    void disconnectAndOpenBlankStudio().catch(showError);
  }
});
workshopApplyTitleButton.addEventListener("click", () => {
  const nextTitle = workshopComicTitle.value.trim();
  if (nextTitle !== comicTitleOverride) recordStudioEdit();
  comicTitleOverride = nextTitle;
  void renderStrip().then(() => {
    renderStripWorkshop();
    setStatus(comicTitleOverride ? `Opening title changed to “${comicTitleOverride}”.` : "The opening title is automatic again.");
  }).catch(showError);
});
workshopSaveProjectButton.addEventListener("click", () => {
  try {
    saveStudioProject();
  } catch (error) {
    showError(error);
  }
});
workshopNewProjectButton.addEventListener("click", () => {
  void newStudioProject().catch(showError);
});
workshopRecoverProjectButton.addEventListener("click", () => {
  void recoverStudioAutosave().catch(showError);
});
workshopUndoButton.addEventListener("click", () => {
  void undoStudioEdit().catch(showError);
});
workshopRedoButton.addEventListener("click", () => {
  void redoStudioEdit().catch(showError);
});
workshopExportComicButton.addEventListener("click", () => downloadStrip());
workshopOpenProjectButton.addEventListener("click", () => workshopProjectFile.click());
workshopProjectFile.addEventListener("change", () => {
  const file = workshopProjectFile.files?.[0];
  if (file) void openStudioProject(file).catch(showError).finally(() => { workshopProjectFile.value = ""; });
});
workshopBackground.addEventListener("change", () => {
  if (workshopBackground.value !== backdropSelect.value) recordStudioEdit();
  backdropSelect.value = workshopBackground.value;
  void loadBackdrop().then(renderStripWorkshop).catch(showError);
});
workshopFont.addEventListener("change", () => {
  const nextFont = parseComicFontId(workshopFont.value);
  if (nextFont !== comicFontId) recordStudioEdit();
  comicFontId = nextFont;
  workshopFont.value = comicFontId;
  balloonFontSelect.value = comicFontId;
  const choice = comicFontOption(comicFontId);
  workshopFont.style.fontFamily = choice.family;
  balloonFontSelect.style.fontFamily = choice.family;
  try {
    localStorage.setItem("comic-chat-balloon-font", comicFontId);
  } catch {}
  setStatus(`Balloon font changed to ${choice.label}. Reflowing the Studio preview…`);
  void renderStrip().then(() => {
    renderStripWorkshop();
    setStatus(`Balloon font: ${choice.label}.`);
  }).catch(showError);
});
workshopAddCharacter.addEventListener("change", () => {
  workshopAddName.value = selectedWorkshopCharacterName();
  void updateWorkshopPosePreview().catch(showError);
});
workshopAddPose.addEventListener("change", () => {
  void updateWorkshopPosePreview().catch(showError);
});
workshopAddMessage.addEventListener("input", () => {
  updateWorkshopTextCount(workshopAddMessage, workshopAddCount);
  scheduleWorkshopPosePreview();
});
workshopAddPlacement.addEventListener("change", updateWorkshopAddActions);
workshopAddSpeakingButton.addEventListener("click", () => {
  void addWorkshopBeat(false).catch(showError);
});
workshopAddSilentButton.addEventListener("click", () => {
  void addWorkshopBeat(true).catch(showError);
});
workshopAddEmptyButton.addEventListener("click", () => {
  void addWorkshopBlankPanel().catch(showError);
});
stripWorkshopDialog.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[value="cancel"]');
  if (!button || !activeWorkshopDraftRow) return;
  if (!window.confirm("Discard the highlighted line edits and close the Studio?")) event.preventDefault();
});
stripWorkshopDialog.addEventListener("cancel", (event) => {
  if (activeWorkshopDraftRow && !window.confirm("Discard the highlighted line edits and close the Studio?")) {
    event.preventDefault();
  }
});
stripWorkshopDialog.addEventListener("close", clearWorkshopDraftLock);
stripWorkshopDialog.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const key = event.key.toLocaleLowerCase();
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  const editingText = Boolean(target?.matches("input, textarea, [contenteditable='true']"));
  if (key === "s") {
    event.preventDefault();
    if (activeWorkshopDraftRow) {
      setStatus("Apply the highlighted line changes before saving the project.");
      return;
    }
    try {
      saveStudioProject();
    } catch (error) {
      showError(error);
    }
  } else if (key === "o") {
    event.preventDefault();
    if (activeWorkshopDraftRow) {
      setStatus("Apply the highlighted line changes before opening another project.");
      return;
    }
    workshopProjectFile.click();
  } else if (!editingText && (key === "z" || key === "y")) {
    event.preventDefault();
    if (activeWorkshopDraftRow) {
      setStatus("Apply or discard the highlighted line changes before using Undo or Redo.");
      return;
    }
    const redo = key === "y" || event.shiftKey;
    void (redo ? redoStudioEdit() : undoStudioEdit()).catch(showError);
  }
});
workshopAddMessage.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void addWorkshopBeat(false).catch(showError);
  }
});
downloadButton.addEventListener("click", downloadStrip);
selectPanelsButton.addEventListener("click", () => setPanelSelectionMode(!panelSelectionMode));
finishPanelSelectionButton.addEventListener("click", () => setPanelSelectionMode(false));
selectAllPanelsButton.addEventListener("click", () => {
  selectedPanelKeys = new Set(panelKeys);
  updateControls();
});
clearPanelSelectionButton.addEventListener("click", () => {
  selectedPanelKeys.clear();
  updateControls();
});
saveSelectedPanelsButton.addEventListener("click", downloadStrip);
strip.addEventListener("click", (event) => {
  if (!panelSelectionMode) return;
  const target = event.target instanceof Element ? event.target : undefined;
  const card = target?.closest<HTMLElement>(".panel-card");
  if (!card || !strip.contains(card)) return;
  event.preventDefault();
  toggleSelectedPanel(card);
});
strip.addEventListener("keydown", (event) => {
  if (!panelSelectionMode || (event.key !== "Enter" && event.key !== " ")) return;
  const target = event.target instanceof Element ? event.target : undefined;
  const card = target?.closest<HTMLElement>(".panel-card");
  if (!card || !strip.contains(card)) return;
  event.preventDefault();
  toggleSelectedPanel(card);
});

function setSystemMenuOpen(open: boolean): void {
  systemMenu.hidden = !open;
  systemMenuButton.setAttribute("aria-expanded", String(open));
}

function setReaderMode(enabled: boolean): void {
  classicWindow.classList.toggle("reader-mode", enabled);
  windowMaximizeButton.textContent = enabled ? "❐" : "□";
  windowMaximizeButton.setAttribute("aria-label", enabled ? "Restore" : "Maximize");
  updatePanelView();
}

function noteTitlebarPoke(): void {
  const now = Date.now();
  titlebarClickTimes = titlebarClickTimes.filter((time) => now - time <= 3_000);
  titlebarClickTimes.push(now);
  if (titlebarClickTimes.length < 10 || now - lastPokeRageAt < 60_000) return;
  titlebarClickTimes = [];
  lastPokeRageAt = now;
  addLocalSelfMessage("STOP POKING ME!!!");
}

function restoreComicWindow(withSurprise = false): void {
  shutdownScreen.hidden = true;
  comicTaskbarButton.hidden = true;
  classicWindow.hidden = false;
  if (withSurprise && !minimizeSurpriseShown) {
    minimizeSurpriseShown = true;
    addLocalSelfMessage("WHERE'D EVERYONE GO?");
  }
  windowMaximizeButton.focus();
}

function runWindowAction(action: string): void {
  setSystemMenuOpen(false);
  noteTitlebarPoke();
  switch (action) {
    case "restore":
      restoreComicWindow();
      setReaderMode(false);
      break;
    case "minimize":
      setReaderMode(false);
      classicWindow.hidden = true;
      comicTaskbarButton.hidden = false;
      comicTaskbarButton.focus();
      break;
    case "maximize":
      setReaderMode(!classicWindow.classList.contains("reader-mode"));
      break;
    case "close":
      setReaderMode(false);
      closeDialog.returnValue = "";
      closeDialog.showModal();
      break;
  }
}

windowMinimizeButton.addEventListener("click", () => runWindowAction("minimize"));
windowMaximizeButton.addEventListener("click", () => runWindowAction("maximize"));
windowCloseButton.addEventListener("click", () => runWindowAction("close"));
comicTaskbarButton.addEventListener("click", () => restoreComicWindow(true));
systemMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSystemMenuOpen(systemMenu.hidden);
});
systemMenu.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  if (!target) return;
  const action = target.closest<HTMLButtonElement>("button[data-window-action]")?.dataset.windowAction;
  if (action) runWindowAction(action);
  if (target.closest<HTMLButtonElement>('button[data-command="about"]')) {
    setSystemMenuOpen(false);
    aboutDialog.showModal();
  }
});
classicTitlebar.addEventListener("dblclick", (event) => {
  if (event.target instanceof Element && event.target.closest("button, .system-menu")) return;
  runWindowAction("maximize");
});
closeDialog.addEventListener("close", () => {
  if (closeDialog.returnValue === "yes") {
    classicWindow.hidden = true;
    comicTaskbarButton.hidden = true;
    shutdownScreen.hidden = false;
    shutdownScreen.focus();
    return;
  }
  if (!closeReliefShown) {
    closeReliefShown = true;
    addLocalSelfMessage("PHEW :)");
  }
});
function leaveShutdownScreen(): void {
  restoreComicWindow();
  setStatus("Welcome back. The comic never disconnected.");
}
shutdownScreen.addEventListener("click", leaveShutdownScreen);
shutdownScreen.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
    event.preventDefault();
    leaveShutdownScreen();
  }
});

function closeClassicMenus(except?: HTMLDetailsElement): void {
  for (const section of classicMenuSections) {
    if (section !== except) section.open = false;
  }
}

function showBotTips(): void {
  const online = FILTERABLE_COMIC_BOTS.filter((bot) =>
    [...knownMembers].some((member) => isComicBotNickname(member, bot)));
  botTipsPresence.textContent = liveState !== "joined"
    ? "Join a channel to see which bots are online."
    : online.length > 0
      ? `Online here: ${online.join(", ")}.`
      : "None of the WebComicChat bots appear to be online in this channel right now.";
  botTipsDialog.showModal();
}

notificationSleepHour.addEventListener("click", () => {
  pendingNotifySleepUntil = Date.now() + 60 * 60_000;
  renderNotificationSleep();
});
notificationSleepEight.addEventListener("click", () => {
  pendingNotifySleepUntil = Date.now() + 8 * 60 * 60_000;
  renderNotificationSleep();
});
notificationResume.addEventListener("click", () => {
  pendingNotifySleepUntil = 0;
  renderNotificationSleep();
});
notificationSave.addEventListener("click", () => {
  const mode = notificationDialog.querySelector<HTMLInputElement>('input[name="notification-mode"]:checked')?.value as NotifyMode | undefined;
  const parsed = parseWatchList(notificationWatch.value);
  if (!mode) {
    showError(new Error("Choose a notification mode"));
    return;
  }
  if (parsed.rejected.length > 0) {
    showError(new Error(`These are not valid IRC nicknames: ${parsed.rejected.join(", ")}`));
    return;
  }
  notifyPolicy.settings = {
    mode,
    sound: notificationSound.checked,
    watch: parsed.watch,
    sleepUntil: pendingNotifySleepUntil > Date.now() ? pendingNotifySleepUntil : 0,
  };
  saveNotifySettings(notificationStorage, notifyPolicy.settings);
  if (mode === "off") {
    notifyPolicy.seen();
    tabAttention.show(0);
  }
  const sleeping = notificationsSleeping(notifyPolicy.settings);
  notificationDialog.close();
  updateControls();
  setStatus(`Notifications: ${notificationModeLabel(mode)}${sleeping ? ` · snoozed until ${new Date(notifyPolicy.settings.sleepUntil).toLocaleTimeString()}` : ""}.`);
  if (mode !== "off" && !sleeping && desktopPermission() === "default") {
    void requestDesktopPermission().then(() => renderNotificationPermission());
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    notifyPolicy.seen();
    tabAttention.show(0);
  }
});

function runMenuCommand(command: string): void {
  const botNickname = HIDE_BOT_COMMANDS[command];
  if (botNickname) {
    toggleHiddenComicBot(botNickname);
    return;
  }
  switch (command) {
    case "new-comic":
    case "clear":
      clearButton.click();
      break;
    case "strip-workshop":
      openStripWorkshop();
      break;
    case "import-avatar":
      importAvatarButton.click();
      break;
    case "import-background":
      importBackdropButton.click();
      break;
    case "create-avatar":
      createAvatarButton.click();
      break;
    case "save-comic":
      downloadButton.click();
      break;
    case "select-panels":
      setPanelSelectionMode(!panelSelectionMode);
      break;
    case "undo":
      undoButton.click();
      break;
    case "write-message":
      messageInput.focus();
      break;
    case "browse-channels":
      browseRoomsButton.click();
      break;
    case "auto-panels":
      panelsAcrossSelect.value = "auto";
      updatePanelView();
      break;
    case "reset-zoom":
      panelSizeInput.value = "100";
      updatePanelView();
      break;
    case "notifications":
    case "notification-help":
      openNotificationSettings();
      break;
    case "plain-text-view":
      plainTextView = !plainTextView;
      try { window.localStorage.setItem(PLAIN_TEXT_KEY, plainTextView ? "1" : "0"); } catch { /* not remembered */ }
      updateControls();
      void renderStrip().then(() => {
        setStatus(plainTextView ? "Plain text view: the chat is shown as text. Turn it off in the View menu to see the comic again." : "Comic view is back.");
      }).catch(showError);
      break;
    case "censor-content":
      censorContent = !censorContent;
      saveComicDisplayPreferences();
      updateControls();
      void renderStrip().then(() => {
        setStatus(censorContent
          ? "Mature and sensitive terms are masked with *** in the comic and saved PNGs. IRC messages are unchanged."
          : "Content censor is off. Original message text is visible again.");
      }).catch(showError);
      break;
    case "mode-say":
    case "mode-think":
    case "mode-whisper":
    case "mode-action":
      document.querySelector<HTMLButtonElement>(`.mode-button[data-mode="${command.slice(5)}"]`)?.click();
      break;
    case "choose-font":
      balloonFontSelect.scrollIntoView({ block: "nearest" });
      balloonFontSelect.focus();
      break;
    case "join-channel":
      connectButton.click();
      break;
    case "copy-channel":
      shareRoomButton.click();
      break;
    case "bookmark-room":
      try {
        bookmarkCurrentRoom();
      } catch (error) {
        showError(error);
      }
      break;
    case "manage-room-bookmarks":
      renderRoomBookmarks();
      roomBookmarksDialog.showModal();
      break;
    case "disconnect":
      disconnectButton.click();
      break;
    case "choose-character":
      characterSelect.scrollIntoView({ block: "nearest" });
      characterSelect.focus();
      break;
    case "community-avatars":
      showCommunityAvatarGallery();
      break;
    case "avatar-rules":
      avatarRulesButton.click();
      break;
    case "comic-tips":
      playHelpEgg();
      break;
    case "bot-tips":
      showBotTips();
      break;
    case "chat-commands":
      chatCommandsDialog.showModal();
      break;
    case "about":
      aboutDialog.showModal();
      break;
  }
}

classicMenu.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  if (!target) return;
  const summary = target.closest("summary");
  if (summary) {
    if (summary.parentElement?.id === "favorites-menu"
      && event instanceof MouseEvent
      && event.ctrlKey
      && event.shiftKey
      && messageInput.value.trim() === "CanThereBMore?") {
      event.preventDefault();
      messageInput.value = "";
      updateControls();
      closeClassicMenus();
      playOriginalCredits();
      return;
    }
    closeClassicMenus(summary.parentElement as HTMLDetailsElement);
    return;
  }
  const commandButton = target.closest<HTMLButtonElement>("button[data-command]");
  if (commandButton && !commandButton.disabled) runMenuCommand(commandButton.dataset.command ?? "");
  if (commandButton || target.closest("a")) closeClassicMenus();
});
document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !classicMenu.contains(event.target)) closeClassicMenus();
  if (event.target instanceof Node && !systemMenu.contains(event.target) && event.target !== systemMenuButton) setSystemMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "F1" && !event.altKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    playHelpEgg();
    return;
  }
  if (event.key === "Escape" && classicWindow.classList.contains("reader-mode")) {
    setReaderMode(false);
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && !systemMenu.hidden) {
    setSystemMenuOpen(false);
    systemMenuButton.focus();
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && classicMenuSections.some((section) => section.open)) {
    closeClassicMenus();
    event.preventDefault();
  }
});

function validatedNickname(): string | undefined {
  const nickname = nicknameInput.value.trim();
  const nicknameIsValid = /^[A-Za-z][A-Za-z0-9_\-[\]\\`^{}]{0,15}$/.test(nickname);
  if (!nicknameIsValid) {
    liveConsole.dataset.state = "error";
    liveStatus.textContent = "Nickname must start with a letter and use IRC-safe characters";
    return undefined;
  }
  return nickname;
}

connectButton.addEventListener("click", () => {
  const nickname = validatedNickname();
  const room = normalizeRoomSelection(networkSelect.value, channelInput.value);
  if (!nickname || !room) {
    if (!room) {
      liveConsole.dataset.state = "error";
      liveStatus.textContent = "Enter a valid #channel";
    }
    return;
  }
  channelInput.value = room.channel;
  if (liveClient.active) {
    try {
      joinRoom(room.channel);
    } catch (error) {
      showError(error);
    }
    return;
  }
  publicRooms.clear();
  roomDirectoryLoaded = false;
  knownMembers.clear();
  renderMembers();
  try {
    liveComicGeneration++;
    liveClient.connect({
      network: room.network,
      nickname,
      channel: room.channel,
    });
  } catch (error) {
    showError(error);
  }
});
browseRoomsButton.addEventListener("click", () => {
  const nickname = validatedNickname();
  if (!nickname) return;
  if (liveClient.active) {
    setRoomBrowserVisible(true);
    renderRoomList();
    if (!roomDirectoryLoaded) {
      try {
        liveClient.listRooms();
      } catch (error) {
        showError(error);
      }
    }
    return;
  }
  publicRooms.clear();
  roomDirectoryLoaded = false;
  knownMembers.clear();
  renderMembers();
  try {
    liveComicGeneration++;
    liveClient.connect({
      network: networkSelect.value === "oftc" ? "oftc" : "libera",
      nickname,
    });
  } catch (error) {
    showError(error);
  }
});
disconnectButton.addEventListener("click", () => liveClient.disconnect());
closeRoomBrowserButton.addEventListener("click", () => setRoomBrowserVisible(false));
shareRoomButton.addEventListener("click", () => copyRoomLink().catch(showError));
networkSelect.addEventListener("change", updateControls);
channelInput.addEventListener("input", () => {
  updateControls();
  if (liveState === "offline" || liveState === "disconnected") {
    setConnectionGuidance("You’re offline.", `Choose a nickname, then join ${channelInput.value || DEFAULT_ROOM_SELECTION.channel} to start chatting.`);
  }
});
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
  comicFontId = parseComicFontId(localStorage.getItem("comic-chat-balloon-font"));
  hiddenComicBots = parseHiddenComicBots(
    localStorage.getItem("comic-chat-hidden-bots"),
    localStorage.getItem("comic-chat-hide-bettybot") === "1",
  );
  censorContent = localStorage.getItem("comic-chat-censor-content") === "1";
  roomBookmarks = parseRoomBookmarks(localStorage.getItem(ROOM_BOOKMARKS_STORAGE_KEY));
} catch {}
try {
  setCharacterPaneLarge(localStorage.getItem("comic-chat-character-pane-large") === "1", false, false);
  setSidebarPaneCollapsed(
    characterPane,
    characterPaneContent,
    characterPaneToggle,
    localStorage.getItem("comic-chat-character-pane-collapsed") === "1",
    "comic-chat-character-pane-collapsed",
    "your character",
    false,
  );
  setSidebarPaneCollapsed(
    memberPane,
    memberPaneContent,
    memberPaneToggle,
    localStorage.getItem("comic-chat-member-pane-collapsed") === "1",
    "comic-chat-member-pane-collapsed",
    "members",
    false,
  );
} catch {}
balloonFontSelect.value = comicFontId;
balloonFontSelect.style.fontFamily = comicFontOption(comicFontId).family;
updatePanelView();
const linkedRoom = roomSelectionFromUrl(new URL(window.location.href));
if (linkedRoom) {
  networkSelect.value = linkedRoom.network;
  channelInput.value = linkedRoom.channel;
  liveStatus.textContent = `Room ready: ${linkedRoom.channel}`;
}
renderRoomBookmarks();
updateControls();
void initialLoad().then(() => {
  if (onGenerationPage) openGenerator();
});
