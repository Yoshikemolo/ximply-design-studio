import { Injectable, computed, signal } from "@angular/core";

/**
 * Sign-in with Keycloak and the licence of advanced mode (FEAT-0032, ADR-0012, ADR-0041).
 * The editor stays a demo without it. Tokens live in memory and in the session storage of
 * the tab, never in documents, local storage or logs; the API decides every licence.
 */
export type Permission = "ai-tools" | "change-control";
export type Tier = "free" | "pro" | "teams" | "studio" | "enterprise";
export const TIERS: { id: Tier; label: string }[] = [
  { id: "free", label: "Free" }, { id: "pro", label: "Pro" }, { id: "teams", label: "Teams" },
  { id: "studio", label: "Studio" }, { id: "enterprise", label: "Enterprise" },
];
export interface Licence {
  state: "valid" | "expired" | "suspended" | "none" | "unrestricted";
  expires: string | null;
  permissions: Permission[];
  tier?: Tier | null;
  status?: "active" | "suspended" | null;
  issued?: string | null;
}
export interface Session { subject: string; username: string; name: string; email: string; admin: boolean; licence: Licence }
export interface IdentityConfiguration { configured: boolean; issuer?: string; clientId?: string }
export type SessionState = "loading" | "not-configured" | "unavailable" | "signed-out" | "signed-in";
export interface Ban { permanent: boolean; until: string | null; reason: string; expired: boolean }
export interface AdminUser {
  id: string; username: string; firstName: string; lastName: string; name: string; email: string; enabled: boolean;
  admin: boolean; created: string | null; lastLogin: string | null; documents: number; ban: Ban | null; licence: Licence;
}
export interface AdminRole { name: "xds-admin" | Permission; kind: "role" | "permission"; description: string; members: string[] }
export interface AdminLicence extends Licence { userId: string; username: string; name: string; email: string }
export interface AdminDocument { id: string; name: string; owner: string | null; size: number; updatedAt: string }
export interface NewUser { username: string; email: string; firstName: string; lastName: string; password: string; temporary: boolean; admin: boolean }
export interface TokenStatus { provider: string; configured: boolean; updatedAt: string | null }

interface Tokens { access: string; refresh: string; idToken: string; expiresAt: number }
interface Pending { state: string; verifier: string; redirect: string }

const TOKENS = "xds-session-tokens";
const PENDING = "xds-session-pending";

export interface SessionEnvironment {
  fetch: typeof fetch;
  location: { origin: string; href: string; assign(url: string): void };
  history: { replaceState(data: unknown, unused: string, url?: string): void };
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  crypto: Pick<Crypto, "getRandomValues" | "subtle">;
  now(): number;
  setTimeout(handler: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function browserEnvironment(): SessionEnvironment {
  return {
    fetch: (...args) => fetch(...args),
    location: { get origin() { return location.origin; }, get href() { return location.href; }, assign: (url) => location.assign(url) },
    history: { replaceState: (data, unused, url) => history.replaceState(data, unused, url) },
    storage: sessionStorage,
    crypto,
    now: () => Date.now(),
    setTimeout: (handler, delay) => setTimeout(handler, delay),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A PKCE verifier and its S256 challenge, as RFC 7636 defines them. */
export async function pkcePair(random: SessionEnvironment["crypto"]): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(random.getRandomValues(new Uint8Array(48)));
  const digest = await random.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

@Injectable({ providedIn: "root" })
export class SessionService {
  readonly state = signal<SessionState>("loading");
  readonly session = signal<Session | null>(null);
  readonly message = signal("");
  readonly isAdmin = computed(() => !!this.session()?.admin);
  /** A signed-in user whose licence is valid, or the super administrator, works in licensed mode. */
  readonly licensed = computed(() => this.state() === "signed-in" && ["valid", "unrestricted"].includes(this.session()?.licence.state ?? ""));
  private config: IdentityConfiguration = { configured: false };
  private tokens: Tokens | null = null;
  private refreshTimer: unknown = null;

  private env: SessionEnvironment = browserEnvironment();

  /** Tests and hosts without a browser give their own environment before starting. */
  useEnvironment(env: SessionEnvironment) { this.env = env; }

  private endpoint(name: "auth" | "token" | "logout") {
    return `${this.config.issuer}/protocol/openid-connect/${name}`;
  }

  /** Reads the server's identity configuration, finishes a sign-in in progress, or resumes the tab's session. */
  async start(): Promise<void> {
    try {
      const answer = await this.env.fetch("/api/identity");
      this.config = answer.ok ? await answer.json() : { configured: false };
    } catch {
      this.config = { configured: false };
    }
    if (!this.config.configured || !this.config.issuer || !this.config.clientId) {
      this.state.set("not-configured");
      return;
    }
    const url = new URL(this.env.location.href);
    if (url.searchParams.has("code") || url.searchParams.has("error")) {
      await this.finishSignIn(url);
      return;
    }
    const saved = this.readTokens();
    if (!saved) { this.state.set("signed-out"); return; }
    this.tokens = saved;
    if (saved.expiresAt - this.env.now() < 30_000 && !(await this.refresh())) return;
    await this.loadSession();
  }

  /** Starts the authorization code flow with PKCE; Keycloak's page also offers registration. */
  async signIn(): Promise<void> {
    if (!this.config.configured) return;
    const { verifier, challenge } = await pkcePair(this.env.crypto);
    const state = base64Url(this.env.crypto.getRandomValues(new Uint8Array(16)));
    const redirect = this.env.location.origin + "/";
    const pending: Pending = { state, verifier, redirect };
    this.env.storage.setItem(PENDING, JSON.stringify(pending));
    const query = new URLSearchParams({ client_id: this.config.clientId!, response_type: "code", scope: "openid",
      redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: "S256" });
    this.env.location.assign(this.endpoint("auth") + "?" + query.toString());
  }

  private async finishSignIn(url: URL): Promise<void> {
    const pending = this.readPending();
    this.env.storage.removeItem(PENDING);
    this.env.history.replaceState({}, "", "/");
    if (!pending || url.searchParams.get("state") !== pending.state || !url.searchParams.get("code")) {
      this.fail("The sign-in could not be verified; sign in again.");
      return;
    }
    const tokens = await this.requestTokens({ grant_type: "authorization_code", code: url.searchParams.get("code")!,
      redirect_uri: pending.redirect, code_verifier: pending.verifier });
    if (!tokens) return;
    await this.loadSession();
  }

  private async requestTokens(form: Record<string, string>): Promise<Tokens | null> {
    try {
      const answer = await this.env.fetch(this.endpoint("token"), {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId!, ...form }).toString(),
      });
      if (!answer.ok) { this.fail("Sign-in failed; sign in again."); return null; }
      const body = await answer.json();
      this.tokens = { access: body.access_token, refresh: body.refresh_token ?? "", idToken: body.id_token ?? this.tokens?.idToken ?? "",
        expiresAt: this.env.now() + Number(body.expires_in ?? 60) * 1000 };
      this.env.storage.setItem(TOKENS, JSON.stringify(this.tokens));
      this.scheduleRefresh();
      return this.tokens;
    } catch {
      this.forget();
      this.state.set("unavailable");
      this.message.set("The sign-in service is unreachable; the editor keeps working as a demo.");
      return null;
    }
  }

  /** Renews the access token before it expires; a failed renewal returns to demo mode. */
  async refresh(): Promise<boolean> {
    if (!this.tokens?.refresh) { this.fail("Your sign-in has ended; sign in again."); return false; }
    return !!(await this.requestTokens({ grant_type: "refresh_token", refresh_token: this.tokens.refresh }));
  }

  private scheduleRefresh() {
    if (this.refreshTimer !== null) this.env.clearTimeout(this.refreshTimer);
    if (!this.tokens) return;
    const delay = Math.max(5_000, this.tokens.expiresAt - this.env.now() - 30_000);
    this.refreshTimer = this.env.setTimeout(() => { void this.refresh().then(async (ok) => { if (ok) await this.loadSession(); }); }, delay);
  }

  private async loadSession(): Promise<void> {
    const answer = await this.request("/api/session");
    if (!answer) return;
    if (!answer.ok) { this.fail((await this.reason(answer)) || "Your sign-in was not accepted; sign in again."); return; }
    this.session.set(await answer.json());
    this.state.set("signed-in");
    this.message.set("");
  }

  /** Ends the Keycloak session and forgets the tokens of the tab. */
  signOut(): void {
    const idToken = this.tokens?.idToken ?? "";
    this.forget();
    this.state.set(this.config.configured ? "signed-out" : "not-configured");
    if (!this.config.configured) return;
    const query = new URLSearchParams({ client_id: this.config.clientId!, post_logout_redirect_uri: this.env.location.origin + "/" });
    if (idToken) query.set("id_token_hint", idToken);
    this.env.location.assign(this.endpoint("logout") + "?" + query.toString());
  }

  /** Whether a capability is available, and the reason to show when it is not. */
  capability(permission: Permission): { allowed: boolean; reason: string } {
    const state = this.state();
    if (state === "not-configured") return { allowed: false, reason: "Advanced mode is not configured on this server." };
    if (state === "unavailable") return { allowed: false, reason: "The sign-in service is unreachable." };
    const session = this.session();
    if (state !== "signed-in" || !session) return { allowed: false, reason: "Sign in to use advanced capabilities." };
    if (session.licence.state === "none") return { allowed: false, reason: "You have no licence for advanced capabilities." };
    if (session.licence.state === "expired") return { allowed: false, reason: "Your licence has expired." };
    if (session.licence.state === "suspended") return { allowed: false, reason: "Your licence is suspended." };
    if (!session.licence.permissions.includes(permission)) return { allowed: false, reason: "Your licence does not include this capability." };
    return { allowed: true, reason: "" };
  }

  /** Calls the API with the access token of the session. */
  async request(path: string, init: RequestInit = {}): Promise<Response | null> {
    if (!this.tokens) { this.fail("Sign in to use advanced capabilities."); return null; }
    try {
      return await this.env.fetch(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: "Bearer " + this.tokens.access,
        ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    } catch {
      this.message.set("The server is unreachable.");
      return null;
    }
  }

  /** The administration workspace's calls; the API refuses them to everyone but the super administrator. */
  private user(id: string) { return `/api/admin/users/${encodeURIComponent(id)}`; }
  async adminUsers(): Promise<AdminUser[]> {
    return (await this.adminCall<{ users: AdminUser[] }>("/api/admin/users")).users;
  }
  createUser(user: NewUser): Promise<AdminUser> { return this.adminCall("/api/admin/users", { method: "POST", body: JSON.stringify(user) }); }
  updateUser(id: string, fields: { email?: string; firstName?: string; lastName?: string; enabled?: boolean }): Promise<AdminUser> {
    return this.adminCall(this.user(id), { method: "PATCH", body: JSON.stringify(fields) });
  }
  deleteUser(id: string): Promise<void> { return this.adminCall(this.user(id), { method: "DELETE" }); }
  setPassword(id: string, password: string, temporary: boolean): Promise<AdminUser> {
    return this.adminCall(this.user(id) + "/password", { method: "PUT", body: JSON.stringify({ password, temporary }) });
  }
  banUser(id: string, until: string | null, reason: string): Promise<AdminUser> {
    return this.adminCall(this.user(id) + "/ban", { method: "PUT", body: JSON.stringify(until ? { until, reason } : { reason }) });
  }
  liftBan(id: string): Promise<AdminUser> { return this.adminCall(this.user(id) + "/ban", { method: "DELETE" }); }
  async adminRoles(): Promise<AdminRole[]> { return (await this.adminCall<{ roles: AdminRole[] }>("/api/admin/roles")).roles; }
  setRole(role: string, id: string, granted: boolean): Promise<AdminUser> {
    return this.adminCall(`/api/admin/roles/${encodeURIComponent(role)}/members/${encodeURIComponent(id)}`, { method: granted ? "PUT" : "DELETE" });
  }
  async adminLicences(): Promise<AdminLicence[]> { return (await this.adminCall<{ licences: AdminLicence[] }>("/api/admin/licences")).licences; }
  issueLicence(id: string, tier: Tier, permissions: Permission[], period: { days: number } | { until: string }): Promise<AdminUser> {
    return this.adminCall(this.user(id) + "/licence", { method: "PUT", body: JSON.stringify({ tier, permissions, ...period }) });
  }
  changeLicence(id: string, change: { tier?: Tier; permissions?: Permission[]; days?: number; until?: string; status?: "active" | "suspended" }): Promise<AdminUser> {
    return this.adminCall(this.user(id) + "/licence", { method: "PATCH", body: JSON.stringify(change) });
  }
  extendLicence(id: string, days: number): Promise<AdminUser> {
    return this.adminCall(this.user(id) + "/licence/extend", { method: "POST", body: JSON.stringify({ days }) });
  }
  revokeLicence(id: string): Promise<AdminUser> { return this.adminCall(this.user(id) + "/licence", { method: "DELETE" }); }
  async adminDocuments(): Promise<AdminDocument[]> { return (await this.adminCall<{ documents: AdminDocument[] }>("/api/admin/documents")).documents; }
  deleteDocument(id: string): Promise<void> { return this.adminCall(`/api/admin/documents/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  /** The user's own external provider token: only its state ever reaches the browser. */
  tokenStatus(provider = "openai"): Promise<TokenStatus> { return this.adminCall(`/api/me/tokens/${provider}`); }
  saveToken(token: string, provider = "openai"): Promise<TokenStatus> {
    return this.adminCall(`/api/me/tokens/${provider}`, { method: "PUT", body: JSON.stringify({ token }) });
  }
  removeToken(provider = "openai"): Promise<void> { return this.adminCall(`/api/me/tokens/${provider}`, { method: "DELETE" }); }
  testToken(provider = "openai"): Promise<{ ok: boolean; detail: string }> {
    return this.adminCall(`/api/me/tokens/${provider}/test`, { method: "POST" });
  }
  private async adminCall<T>(path: string, init: RequestInit = {}): Promise<T> {
    const answer = await this.request(path, init);
    if (!answer) throw new Error(this.message() || "The server is unreachable.");
    if (!answer.ok) throw new Error((await this.reason(answer)) || `The server refused the request (${answer.status}).`);
    return answer.status === 204 ? (undefined as T) : answer.json();
  }

  private async reason(answer: Response): Promise<string> {
    try {
      const body = await answer.json();
      return typeof body?.detail === "string" ? body.detail : "";
    } catch {
      return "";
    }
  }

  private fail(message: string) {
    this.forget();
    this.state.set(this.config.configured ? "signed-out" : "not-configured");
    this.message.set(message);
  }

  private forget() {
    this.tokens = null;
    this.session.set(null);
    this.env.storage.removeItem(TOKENS);
    if (this.refreshTimer !== null) this.env.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private readTokens(): Tokens | null {
    try {
      const saved = JSON.parse(this.env.storage.getItem(TOKENS) ?? "null");
      return saved && typeof saved.access === "string" && typeof saved.expiresAt === "number" ? saved : null;
    } catch {
      return null;
    }
  }

  private readPending(): Pending | null {
    try {
      const saved = JSON.parse(this.env.storage.getItem(PENDING) ?? "null");
      return saved && typeof saved.state === "string" && typeof saved.verifier === "string" ? saved : null;
    } catch {
      return null;
    }
  }
}
