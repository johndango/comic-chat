import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { validateAvatarImport, MAX_AVATAR_FILE_BYTES } from "../src/avatar-import";

const MAX_JSON_BYTES = Math.ceil(MAX_AVATAR_FILE_BYTES * 4 / 3) + 16 * 1024;
const REPORT_REASONS = new Set(["sexual", "real-person", "hate", "harassment", "violence", "copyright", "spam", "other"]);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;

interface StoredAvatar {
  id: string;
  name: string;
  announcementName: string;
  file: string;
  creator?: string;
  description?: string;
  sourceUrl?: string;
  uploadedAt: string;
  bytes: number;
  sha256: string;
}

interface StoredReport {
  id: string;
  avatarId: string;
  reason: string;
  details?: string;
  createdAt: string;
  reporter: string;
  status: "open" | "dismissed" | "removed";
}

interface CommunityState {
  version: 1;
  avatars: StoredAvatar[];
  reports: StoredReport[];
  hiddenIds: string[];
  blockedHashes: string[];
}

interface UploadBody {
  name?: unknown;
  creator?: unknown;
  description?: unknown;
  sourceUrl?: unknown;
  filename?: unknown;
  fileBase64?: unknown;
  rightsConfirmed?: unknown;
  rulesConfirmed?: unknown;
}

interface ReportBody { reason?: unknown; details?: unknown }

export interface CommunityAvatarRequestContext {
  address: string;
  mutationAllowed: boolean;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function cleanText(value: unknown, maximum: number, required = false): string | undefined {
  const clean = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, "").trim() : "";
  if (!clean && required) throw new HttpError(400, "A character name is required");
  return clean ? clean.slice(0, maximum) : undefined;
}

function sourceUrl(value: unknown): string | undefined {
  const clean = cleanText(value, 500);
  if (!clean) return undefined;
  try {
    const url = new URL(clean);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new HttpError(400, "The source or credit link must be a public HTTPS address");
  }
}

function safeState(value: unknown): CommunityState {
  const source = value && typeof value === "object" ? value as Partial<CommunityState> : {};
  return {
    version: 1,
    avatars: Array.isArray(source.avatars) ? source.avatars.filter((avatar): avatar is StoredAvatar => Boolean(avatar && SAFE_ID.test(avatar.id))) : [],
    reports: Array.isArray(source.reports) ? source.reports.filter((report): report is StoredReport => Boolean(report && typeof report.id === "string" && SAFE_ID.test(report.avatarId))) : [],
    hiddenIds: Array.isArray(source.hiddenIds) ? source.hiddenIds.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)) : [],
    blockedHashes: Array.isArray(source.blockedHashes)
      ? source.blockedHashes.filter((hash): hash is string => typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash))
      : [],
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new HttpError(413, "Upload is too large");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    length += chunk.length;
    if (length > MAX_JSON_BYTES) throw new HttpError(413, "Upload is too large");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function avatarSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").toLocaleLowerCase().slice(0, 45);
  return slug || "character";
}

function announcementName(name: string): string {
  return name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 60) || "Community_character";
}

function arrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function bearerToken(request: IncomingMessage): string {
  const match = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/u);
  return match?.[1] ?? "";
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class CommunityAvatarService {
  private readonly statePath: string;
  private readonly filesDirectory: string;
  private readonly tokenPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly uploadsByAddress = new Map<string, number[]>();
  private readonly reportsByAddress = new Map<string, number[]>();
  private token?: string;

  constructor(directory: string, private readonly configuredToken?: string) {
    this.statePath = join(directory, "catalog.json");
    this.filesDirectory = join(directory, "files");
    this.tokenPath = join(directory, "admin-token");
  }

  private async initialize(): Promise<void> {
    await mkdir(this.filesDirectory, { recursive: true });
  }

  private async readState(): Promise<CommunityState> {
    await this.initialize();
    try {
      return safeState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, avatars: [], reports: [], hiddenIds: [], blockedHashes: [] };
    }
  }

  private async writeState(state: CommunityState): Promise<void> {
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private rateLimit(map: Map<string, number[]>, address: string, maximum: number, windowMs: number, message: string): void {
    const now = Date.now();
    const recent = (map.get(address) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maximum) throw new HttpError(429, message);
    recent.push(now);
    map.set(address, recent);
  }

  private async adminToken(): Promise<string> {
    if (this.configuredToken && this.configuredToken.length >= 32) return this.configuredToken;
    if (this.token) return this.token;
    await this.initialize();
    try {
      this.token = (await readFile(this.tokenPath, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const generated = randomBytes(32).toString("base64url");
      try {
        await writeFile(this.tokenPath, `${generated}\n`, { mode: 0o600, flag: "wx" });
        this.token = generated;
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        this.token = (await readFile(this.tokenPath, "utf8")).trim();
      }
    }
    return this.token;
  }

  private async requireAdmin(request: IncomingMessage): Promise<void> {
    const supplied = bearerToken(request);
    const expected = await this.adminToken();
    if (!supplied || !sameSecret(supplied, expected)) throw new HttpError(401, "Admin token is invalid");
  }

  private requireMutation(context: CommunityAvatarRequestContext): void {
    if (!context.mutationAllowed) throw new HttpError(403, "Request origin rejected");
  }

  private async upload(request: IncomingMessage, context: CommunityAvatarRequestContext): Promise<StoredAvatar> {
    this.requireMutation(context);
    this.rateLimit(this.uploadsByAddress, context.address, 3, 60 * 60_000, "Upload limit reached; try again later");
    const body = await jsonBody(request) as UploadBody;
    if (body.rightsConfirmed !== true || body.rulesConfirmed !== true) {
      throw new HttpError(400, "Confirm both the sharing rights and community content rules");
    }
    const filename = cleanText(body.filename, 100, true)!;
    if (!/^[^/\\]{1,100}\.avb$/iu.test(filename)) throw new HttpError(400, "Choose a Comic Chat .avb character file");
    if (typeof body.fileBase64 !== "string" || body.fileBase64.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(body.fileBase64)) {
      throw new HttpError(400, "Avatar file data is missing or unreadable");
    }
    const bytes = Buffer.from(body.fileBase64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_FILE_BYTES) throw new HttpError(413, "Avatar files must be 2 MB or smaller");
    let validated;
    try {
      validated = await validateAvatarImport(arrayBuffer(bytes), filename);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "That is not a valid Comic Chat avatar");
    }
    const name = cleanText(body.name, 60) ?? validated.name;
    const creator = cleanText(body.creator, 80);
    const description = cleanText(body.description, 240);
    const creditUrl = sourceUrl(body.sourceUrl);
    const hash = createHash("sha256").update(bytes).digest("hex");

    return this.serialized(async () => {
      const state = await this.readState();
      if (state.blockedHashes.includes(hash)) throw new HttpError(409, "This avatar was removed from the community gallery and cannot be republished");
      if (state.avatars.some((avatar) => avatar.sha256 === hash)) throw new HttpError(409, "That exact avatar is already in the community gallery");
      if (state.avatars.length >= 500) throw new HttpError(503, "The community gallery is temporarily full");
      const id = `${avatarSlug(name)}-${randomBytes(5).toString("hex")}`;
      const file = `${id}.avb`;
      const avatar: StoredAvatar = {
        id,
        name,
        announcementName: announcementName(name),
        file,
        ...(creator ? { creator } : {}),
        ...(description ? { description } : {}),
        ...(creditUrl ? { sourceUrl: creditUrl } : {}),
        uploadedAt: new Date().toISOString(),
        bytes: bytes.length,
        sha256: hash,
      };
      const filePath = join(this.filesDirectory, file);
      await writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
      try {
        state.avatars.push(avatar);
        await this.writeState(state);
      } catch (error) {
        await unlink(filePath).catch(() => {});
        throw error;
      }
      return avatar;
    });
  }

  private async report(avatarId: string, request: IncomingMessage, context: CommunityAvatarRequestContext): Promise<void> {
    this.requireMutation(context);
    if (!SAFE_ID.test(avatarId)) throw new HttpError(404, "Avatar not found");
    this.rateLimit(this.reportsByAddress, context.address, 10, 24 * 60 * 60_000, "Report limit reached; try again tomorrow");
    const body = await jsonBody(request) as ReportBody;
    const reason = typeof body.reason === "string" && REPORT_REASONS.has(body.reason) ? body.reason : undefined;
    if (!reason) throw new HttpError(400, "Choose a report reason");
    const details = cleanText(body.details, 500);
    const reporter = createHash("sha256").update(context.address).digest("hex").slice(0, 16);
    await this.serialized(async () => {
      const state = await this.readState();
      const recentDuplicate = state.reports.some((report) => report.avatarId === avatarId && report.reporter === reporter
        && Date.now() - Date.parse(report.createdAt) < 24 * 60 * 60_000);
      if (recentDuplicate) throw new HttpError(409, "You already reported this avatar recently");
      state.reports.push({ id: randomUUID(), avatarId, reason, ...(details ? { details } : {}), createdAt: new Date().toISOString(), reporter, status: "open" });
      if (state.reports.length > 2_000) state.reports.splice(0, state.reports.length - 2_000);
      await this.writeState(state);
    });
  }

  private async removeAvatar(avatarId: string): Promise<void> {
    if (!SAFE_ID.test(avatarId)) throw new HttpError(404, "Avatar not found");
    await this.serialized(async () => {
      const state = await this.readState();
      const avatar = state.avatars.find((entry) => entry.id === avatarId);
      if (avatar) {
        if (!state.blockedHashes.includes(avatar.sha256)) state.blockedHashes.push(avatar.sha256);
      } else if (!state.hiddenIds.includes(avatarId)) {
        // Bundled avatars are not in the writable catalog, so remember their
        // public catalog ID instead of a file fingerprint.
        state.hiddenIds.push(avatarId);
      }
      state.avatars = state.avatars.filter((entry) => entry.id !== avatarId);
      for (const report of state.reports) if (report.avatarId === avatarId && report.status === "open") report.status = "removed";
      await this.writeState(state);
      if (avatar) await unlink(join(this.filesDirectory, avatar.file)).catch(() => {});
    });
  }

  async handle(request: IncomingMessage, response: ServerResponse, context: CommunityAvatarRequestContext): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const method = request.method ?? "GET";
    const isCommunityRoute = pathname === "/api/community-avatars"
      || pathname.startsWith("/api/community-avatars/")
      || pathname.startsWith("/api/community-admin")
      || pathname.startsWith("/community-avatars/");
    if (!isCommunityRoute) return false;

    try {
      if (method === "GET" && pathname === "/api/community-avatars") {
        const state = await this.readState();
        const hidden = new Set(state.hiddenIds);
        json(response, 200, { version: 1, avatars: state.avatars.filter((avatar) => !hidden.has(avatar.id)), hiddenIds: state.hiddenIds });
        return true;
      }
      if (method === "POST" && pathname === "/api/community-avatars") {
        const avatar = await this.upload(request, context);
        json(response, 201, { avatar });
        return true;
      }
      const reportMatch = pathname.match(/^\/api\/community-avatars\/([a-z0-9-]+)\/reports$/u);
      if (method === "POST" && reportMatch) {
        await this.report(reportMatch[1], request, context);
        json(response, 201, { ok: true });
        return true;
      }
      const fileMatch = pathname.match(/^\/community-avatars\/([a-z0-9-]+\.avb)$/u);
      if (method === "GET" && fileMatch) {
        const state = await this.readState();
        const file = basename(fileMatch[1]);
        const avatar = state.avatars.find((entry) => entry.file === file && !state.hiddenIds.includes(entry.id));
        if (!avatar) throw new HttpError(404, "Avatar not found");
        const bytes = await readFile(join(this.filesDirectory, file));
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": bytes.length,
          "cache-control": "public, max-age=3600",
          "content-disposition": `inline; filename="${file}"`,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        response.end(bytes);
        return true;
      }
      if (pathname.startsWith("/api/community-admin")) {
        if (method !== "GET") this.requireMutation(context);
        await this.requireAdmin(request);
        if (method === "GET" && pathname === "/api/community-admin") {
          const state = await this.readState();
          json(response, 200, state);
          return true;
        }
        const avatarMatch = pathname.match(/^\/api\/community-admin\/avatars\/([a-z0-9-]+)$/u);
        if (method === "DELETE" && avatarMatch) {
          await this.removeAvatar(avatarMatch[1]);
          json(response, 200, { ok: true });
          return true;
        }
        const reportMatch = pathname.match(/^\/api\/community-admin\/reports\/([0-9a-f-]+)\/dismiss$/u);
        if (method === "POST" && reportMatch) {
          await this.serialized(async () => {
            const state = await this.readState();
            const report = state.reports.find((entry) => entry.id === reportMatch[1]);
            if (!report) throw new HttpError(404, "Report not found");
            report.status = "dismissed";
            await this.writeState(state);
          });
          json(response, 200, { ok: true });
          return true;
        }
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      json(response, status, { error: error instanceof HttpError ? error.message : "Community avatar service failed" });
      return true;
    }
  }
}
