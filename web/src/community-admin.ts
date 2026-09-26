import "./styles.css";
import "./community-admin.css";

interface AdminAvatar {
  id: string;
  name: string;
  file: string;
  creator?: string;
  description?: string;
  sourceUrl?: string;
  uploadedAt: string;
  bytes: number;
}

interface AdminReport {
  id: string;
  avatarId: string;
  reason: string;
  details?: string;
  createdAt: string;
  status: "open" | "dismissed" | "removed";
}

interface AdminState { avatars: AdminAvatar[]; reports: AdminReport[]; hiddenIds: string[] }

const root = document.querySelector<HTMLElement>("#community-admin");
if (!root) throw new Error("Missing admin root");

root.innerHTML = `
  <section class="classic-window admin-window">
    <header class="classic-titlebar"><strong>WebComicChat Community Moderation</strong></header>
    <div class="admin-body">
      <section id="admin-login" class="admin-login">
        <h1>Moderator sign in</h1>
        <p>This unlisted page requires the community admin token. It is kept only in this browser tab.</p>
        <label>Admin token <input id="admin-token" type="password" autocomplete="off" /></label>
        <button id="admin-login-button" type="button">Open moderation queue</button>
      </section>
      <section id="admin-dashboard" hidden>
        <div class="admin-toolbar"><strong>Community avatar queue</strong><span id="admin-summary"></span><button id="admin-refresh" type="button">Refresh</button><button id="admin-logout" type="button">Forget token</button></div>
        <p id="admin-status" role="status"></p>
        <section><h2>Open reports</h2><div id="admin-reports" class="admin-list"></div></section>
        <section><h2>Published uploads</h2><div id="admin-avatars" class="admin-list"></div></section>
        <details><summary>Removed or hidden avatar IDs</summary><ul id="admin-hidden"></ul></details>
      </section>
    </div>
  </section>`;

const element = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};

const login = element<HTMLElement>("#admin-login");
const dashboard = element<HTMLElement>("#admin-dashboard");
const tokenInput = element<HTMLInputElement>("#admin-token");
const status = element<HTMLElement>("#admin-status");
const summary = element<HTMLElement>("#admin-summary");
const reports = element<HTMLElement>("#admin-reports");
const avatars = element<HTMLElement>("#admin-avatars");
const hidden = element<HTMLElement>("#admin-hidden");
const TOKEN_KEY = "webcomicchat.communityAdminToken";
let token = "";

function consumeFragmentToken(): string {
  const match = location.hash.match(/^#token=([A-Za-z0-9_-]{32,})$/u);
  if (!match) return "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return match[1];
}

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${token}`, ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Admin service returned ${response.status}`);
  return body as T;
}

function actionButton(label: string, action: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    button.disabled = true;
    void action().catch((error) => { status.textContent = error instanceof Error ? error.message : "Action failed"; }).finally(() => { button.disabled = false; });
  });
  return button;
}

function render(state: AdminState): void {
  const byId = new Map(state.avatars.map((avatar) => [avatar.id, avatar]));
  const open = state.reports.filter((report) => report.status === "open");
  summary.textContent = `${open.length} open ${open.length === 1 ? "report" : "reports"} · ${state.avatars.length} published uploads`;
  reports.replaceChildren();
  avatars.replaceChildren();
  hidden.replaceChildren(...state.hiddenIds.map((id) => Object.assign(document.createElement("li"), { textContent: id })));

  if (open.length === 0) reports.append(Object.assign(document.createElement("p"), { className: "admin-empty", textContent: "No open reports." }));
  for (const report of open.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const avatar = byId.get(report.avatarId);
    const card = document.createElement("article");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${avatar?.name ?? report.avatarId} — ${report.reason}`;
    const meta = document.createElement("small");
    meta.textContent = new Date(report.createdAt).toLocaleString();
    const detail = document.createElement("p");
    detail.textContent = report.details || "No details supplied.";
    copy.append(title, meta, detail);
    const actions = document.createElement("div");
    actions.append(
      actionButton("Remove avatar", async () => {
        if (!confirm(`Remove ${avatar?.name ?? report.avatarId} from the public gallery?`)) return;
        await adminApi(`/api/community-admin/avatars/${encodeURIComponent(report.avatarId)}`, { method: "DELETE" });
        await load();
      }),
      actionButton("Dismiss report", async () => {
        await adminApi(`/api/community-admin/reports/${encodeURIComponent(report.id)}/dismiss`, { method: "POST" });
        await load();
      }),
    );
    card.append(copy, actions);
    reports.append(card);
  }

  if (state.avatars.length === 0) avatars.append(Object.assign(document.createElement("p"), { className: "admin-empty", textContent: "No user uploads are published." }));
  for (const avatar of [...state.avatars].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))) {
    const card = document.createElement("article");
    const copy = document.createElement("div");
    const title = document.createElement("a");
    title.href = `/community-avatars/${encodeURIComponent(avatar.file)}`;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = avatar.name;
    const meta = document.createElement("small");
    meta.textContent = `${avatar.creator ? `By ${avatar.creator} · ` : ""}${Math.ceil(avatar.bytes / 1024)} KB · ${new Date(avatar.uploadedAt).toLocaleString()}`;
    const detail = document.createElement("p");
    detail.textContent = avatar.description || "No description.";
    copy.append(title, meta, detail);
    const remove = actionButton("Remove", async () => {
      if (!confirm(`Remove ${avatar.name} from the public gallery?`)) return;
      await adminApi(`/api/community-admin/avatars/${encodeURIComponent(avatar.id)}`, { method: "DELETE" });
      await load();
    });
    card.append(copy, remove);
    avatars.append(card);
  }
}

async function load(): Promise<void> {
  status.textContent = "Loading…";
  const state = await adminApi<AdminState>("/api/community-admin", { cache: "no-store" });
  login.hidden = true;
  dashboard.hidden = false;
  render(state);
  status.textContent = "Queue updated.";
}

async function signIn(nextToken: string): Promise<void> {
  token = nextToken.trim();
  if (token.length < 32) throw new Error("Enter the complete admin token");
  sessionStorage.setItem(TOKEN_KEY, token);
  await load();
}

element<HTMLButtonElement>("#admin-login-button").addEventListener("click", () => {
  void signIn(tokenInput.value).catch((error) => { tokenInput.setCustomValidity(error instanceof Error ? error.message : "Could not sign in"); tokenInput.reportValidity(); });
});
tokenInput.addEventListener("input", () => tokenInput.setCustomValidity(""));
element<HTMLButtonElement>("#admin-refresh").addEventListener("click", () => void load().catch((error) => { status.textContent = error instanceof Error ? error.message : "Refresh failed"; }));
element<HTMLButtonElement>("#admin-logout").addEventListener("click", () => {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  dashboard.hidden = true;
  login.hidden = false;
  tokenInput.value = "";
  tokenInput.focus();
});

const initialToken = consumeFragmentToken() || sessionStorage.getItem(TOKEN_KEY) || "";
if (initialToken) void signIn(initialToken).catch(() => { sessionStorage.removeItem(TOKEN_KEY); tokenInput.focus(); });
else tokenInput.focus();
