// @vitest-environment happy-dom
import '@angular/compiler';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionService, pkcePair, type SessionEnvironment } from '../src/app/session.service';

const ISSUER = 'http://localhost:8090/auth/realms/xds';
const SESSION = { subject: 'u1', username: 'ana', name: 'Ana Diaz', email: 'ana@example.test', admin: false,
  licence: { state: 'valid', expires: '2026-10-23T10:00:00Z', permissions: ['ai-tools'] } };

type Call = { url: string; init?: RequestInit };
function environment(routes: Record<string, (call: Call) => Response | Promise<Response>>, href = 'http://localhost:8090/') {
  const calls: Call[] = [], assigned: string[] = [], replaced: string[] = [], timers: { handler: () => void; delay: number }[] = [];
  const store = new Map<string, string>();
  let now = 1_000_000;
  const env: SessionEnvironment = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), call = { url, init };
      calls.push(call);
      const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      if (!route) throw new TypeError('network down');
      return routes[route](call);
    }) as typeof fetch,
    location: { origin: 'http://localhost:8090', href, assign: (url) => { assigned.push(url); } },
    history: { replaceState: (_data, _unused, url) => { replaced.push(String(url)); } },
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: (key) => { store.delete(key); } },
    crypto: webcrypto as unknown as Crypto,
    now: () => now,
    setTimeout: (handler, delay) => { timers.push({ handler, delay }); return timers.length; },
    clearTimeout: () => undefined,
  };
  return { env, calls, assigned, replaced, timers, store, advance: (ms: number) => { now += ms; } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const configured = () => json({ configured: true, issuer: ISSUER, clientId: 'xds-studio' });
const tokens = (extra = {}) => json({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: 'id-1', expires_in: 300, ...extra });

function service(env: SessionEnvironment) {
  const session = new SessionService();
  session.useEnvironment(env);
  return session;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('demo mode (SC-0134, SC-0139)', () => {
  it('stays a demo when the server has no identity configured, and asks nothing of Keycloak', async () => {
    const world = environment({ '/api/identity': () => json({ configured: false, mode: 'demo' }) });
    const session = service(world.env);
    await session.start();
    expect(session.state()).toBe('not-configured');
    expect(world.calls.map((call) => call.url)).toEqual(['/api/identity']);
    expect(session.capability('ai-tools')).toEqual({ allowed: false, reason: 'Advanced mode is not configured on this server.' });
    await session.signIn();
    expect(world.assigned).toEqual([]);
  });
  it('treats an unreachable API as a demo', async () => {
    const session = service(environment({}).env);
    await session.start();
    expect(session.state()).toBe('not-configured');
  });
});

describe('sign-in with PKCE (SC-0135)', () => {
  it('sends an S256 challenge of a verifier kept in the tab, and a state', async () => {
    const world = environment({ '/api/identity': configured });
    const session = service(world.env);
    await session.start();
    expect(session.state()).toBe('signed-out');
    expect(session.capability('ai-tools').reason).toBe('Sign in to use advanced capabilities.');
    await session.signIn();
    const url = new URL(world.assigned[0]);
    expect(url.origin + url.pathname).toBe(ISSUER + '/protocol/openid-connect/auth');
    const pending = JSON.parse(world.store.get('xds-session-pending')!);
    const expected = createHash('sha256').update(pending.verifier).digest('base64url');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'xds-studio', response_type: 'code', scope: 'openid',
      redirect_uri: 'http://localhost:8090/', state: pending.state, code_challenge: expected, code_challenge_method: 'S256' });
    expect(pending.verifier.length).toBeGreaterThanOrEqual(43);
    expect(localStorage.length).toBe(0);
  });

  it('exchanges the code with the verifier, loads the session and cleans the address', async () => {
    const world = environment({
      '/api/identity': configured,
      [ISSUER + '/protocol/openid-connect/token']: () => tokens(),
      '/api/session': () => json(SESSION),
    }, 'http://localhost:8090/?state=s1&session_state=x&code=c1');
    world.store.set('xds-session-pending', JSON.stringify({ state: 's1', verifier: 'v'.repeat(64), redirect: 'http://localhost:8090/' }));
    const session = service(world.env);
    await session.start();
    const exchange = world.calls.find((call) => call.url.endsWith('/token'))!;
    expect(Object.fromEntries(new URLSearchParams(String(exchange.init!.body)))).toEqual({ client_id: 'xds-studio',
      grant_type: 'authorization_code', code: 'c1', redirect_uri: 'http://localhost:8090/', code_verifier: 'v'.repeat(64) });
    const sessionCall = world.calls.find((call) => call.url === '/api/session')!;
    expect((sessionCall.init!.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
    expect(session.state()).toBe('signed-in');
    expect(session.session()).toEqual(SESSION);
    expect(world.replaced).toEqual(['/']);
    expect(world.store.has('xds-session-pending')).toBe(false);
    expect(JSON.parse(world.store.get('xds-session-tokens')!).access).toBe('access-1');
    expect(localStorage.length).toBe(0);
    expect(session.capability('ai-tools')).toEqual({ allowed: true, reason: '' });
    expect(session.capability('change-control').reason).toBe('Your licence does not include this capability.');
    // The token is renewed thirty seconds before it expires.
    expect(world.timers.at(-1)!.delay).toBe(270_000);
  });

  it('refuses a callback whose state differs, without asking for tokens', async () => {
    const world = environment({ '/api/identity': configured, [ISSUER]: () => tokens() }, 'http://localhost:8090/?state=forged&code=c1');
    world.store.set('xds-session-pending', JSON.stringify({ state: 's1', verifier: 'v'.repeat(64), redirect: 'http://localhost:8090/' }));
    const session = service(world.env);
    await session.start();
    expect(world.calls.some((call) => call.url.endsWith('/token'))).toBe(false);
    expect(session.state()).toBe('signed-out');
    expect(session.message()).toBe('The sign-in could not be verified; sign in again.');
    expect(world.store.has('xds-session-tokens')).toBe(false);
  });

  it('reports an unreachable Keycloak and keeps the demo', async () => {
    const world = environment({ '/api/identity': configured }, 'http://localhost:8090/?state=s1&code=c1');
    world.store.set('xds-session-pending', JSON.stringify({ state: 's1', verifier: 'v'.repeat(64), redirect: 'http://localhost:8090/' }));
    const session = service(world.env);
    await session.start();
    expect(session.state()).toBe('unavailable');
    expect(session.capability('ai-tools').reason).toBe('The sign-in service is unreachable.');
  });

  it('resumes the tab, renews a token about to expire and returns to demo when renewal fails', async () => {
    let renewals = 0;
    const world = environment({
      '/api/identity': configured,
      [ISSUER + '/protocol/openid-connect/token']: () => (++renewals === 1 ? tokens({ access_token: 'access-2' }) : json({ error: 'invalid_grant' }, 400)),
      '/api/session': () => json(SESSION),
    });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'access-1', refresh: 'refresh-1', idToken: 'id-1', expiresAt: 1_000_000 + 10_000 }));
    const session = service(world.env);
    await session.start();
    expect(session.state()).toBe('signed-in');
    const renewal = world.calls.find((call) => call.url.endsWith('/token'))!;
    expect(Object.fromEntries(new URLSearchParams(String(renewal.init!.body)))).toEqual({ client_id: 'xds-studio', grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    expect(await session.refresh()).toBe(false);
    expect(session.state()).toBe('signed-out');
    expect(session.session()).toBeNull();
    expect(world.store.has('xds-session-tokens')).toBe(false);
  });

  it('shows the reason the API gives when it refuses the session', async () => {
    const world = environment({ '/api/identity': configured, '/api/session': () => json({ detail: 'The sign-in has expired' }, 401) });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    expect([session.state(), session.message()]).toEqual(['signed-out', 'The sign-in has expired']);
  });

  it('signs out of Keycloak and forgets the tokens', async () => {
    const world = environment({ '/api/identity': configured, '/api/session': () => json(SESSION) });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: 'id-9', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    session.signOut();
    const url = new URL(world.assigned[0]);
    expect(url.pathname).toBe('/auth/realms/xds/protocol/openid-connect/logout');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'xds-studio', post_logout_redirect_uri: 'http://localhost:8090/', id_token_hint: 'id-9' });
    expect([session.state(), session.session(), world.store.has('xds-session-tokens')]).toEqual(['signed-out', null, false]);
  });

  it('describes expired and missing licences', async () => {
    for (const [licence, reason] of [[{ state: 'expired', expires: '2026-01-01T00:00:00Z', permissions: [] }, 'Your licence has expired.'],
      [{ state: 'none', expires: null, permissions: [] }, 'You have no licence for advanced capabilities.']] as const) {
      const world = environment({ '/api/identity': configured, '/api/session': () => json({ ...SESSION, licence }) });
      world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
      const session = service(world.env);
      await session.start();
      expect(session.capability('ai-tools').reason).toBe(reason);
    }
  });
});

describe('administration calls (SC-0137, SC-0138)', () => {
  async function admin(routes: Record<string, (call: Call) => Response>) {
    const world = environment({ '/api/identity': configured, '/api/session': () => json({ ...SESSION, admin: true }), ...routes });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    return { session, world };
  }
  it('sends each change with the token and the exact body', async () => {
    const user = { id: 'u 1', username: 'ana', name: 'Ana', email: '', enabled: true, licence: SESSION.licence };
    const { session, world } = await admin({
      '/api/admin/users': () => json({ total: 1, users: [user] }), '/api/admin/roles': () => json({ roles: [] }),
      '/api/admin/licences': () => json({ licences: [] }), '/api/admin/documents': () => json({ documents: [] }),
      '/api/me/tokens': () => json({ provider: 'openai', configured: true, updatedAt: null }),
    });
    expect(session.isAdmin()).toBe(true);
    expect(await session.adminUsers()).toEqual([user]);
    expect(await session.adminRoles()).toEqual([]);
    expect(await session.adminLicences()).toEqual([]);
    expect(await session.adminDocuments()).toEqual([]);
    await session.createUser({ username: 'luis', email: 'l@example.test', firstName: 'L', lastName: 'G', password: 'Secret-Pass-9', temporary: true, admin: false });
    await session.updateUser('u 1', { email: 'a@example.test' });
    await session.setPassword('u 1', 'New-Pass-123', false);
    await session.banUser('u 1', '2026-10-01T00:00:00.000Z', 'abuse');
    await session.banUser('u 1', null, '');
    await session.liftBan('u 1');
    await session.setRole('ai-tools', 'u 1', true);
    await session.setRole('xds-admin', 'u 1', false);
    await session.issueLicence('u 1', 'studio', ['ai-tools'], { days: 30 });
    await session.changeLicence('u 1', { status: 'suspended' });
    await session.extendLicence('u 1', 10);
    await session.revokeLicence('u 1');
    await session.deleteUser('u 1');
    await session.deleteDocument('d1');
    await session.tokenStatus();
    await session.saveToken('sk-abc');
    await session.testToken();
    await session.removeToken();
    const sent = world.calls.filter((call) => /\/api\/(admin|me)/.test(call.url)).map((call) => [call.init?.method ?? 'GET', call.url, call.init?.body ?? null]);
    expect(sent).toEqual([
      ['GET', '/api/admin/users', null], ['GET', '/api/admin/roles', null], ['GET', '/api/admin/licences', null], ['GET', '/api/admin/documents', null],
      ['POST', '/api/admin/users', '{"username":"luis","email":"l@example.test","firstName":"L","lastName":"G","password":"Secret-Pass-9","temporary":true,"admin":false}'],
      ['PATCH', '/api/admin/users/u%201', '{"email":"a@example.test"}'],
      ['PUT', '/api/admin/users/u%201/password', '{"password":"New-Pass-123","temporary":false}'],
      ['PUT', '/api/admin/users/u%201/ban', '{"until":"2026-10-01T00:00:00.000Z","reason":"abuse"}'],
      ['PUT', '/api/admin/users/u%201/ban', '{"reason":""}'],
      ['DELETE', '/api/admin/users/u%201/ban', null],
      ['PUT', '/api/admin/roles/ai-tools/members/u%201', null],
      ['DELETE', '/api/admin/roles/xds-admin/members/u%201', null],
      ['PUT', '/api/admin/users/u%201/licence', '{"tier":"studio","permissions":["ai-tools"],"days":30}'],
      ['PATCH', '/api/admin/users/u%201/licence', '{"status":"suspended"}'],
      ['POST', '/api/admin/users/u%201/licence/extend', '{"days":10}'],
      ['DELETE', '/api/admin/users/u%201/licence', null],
      ['DELETE', '/api/admin/users/u%201', null],
      ['DELETE', '/api/admin/documents/d1', null],
      ['GET', '/api/me/tokens/openai', null], ['PUT', '/api/me/tokens/openai', '{"token":"sk-abc"}'],
      ['POST', '/api/me/tokens/openai/test', null], ['DELETE', '/api/me/tokens/openai', null],
    ]);
    expect(world.calls.filter((call) => /\/api\/(admin|me)/.test(call.url)).every((call) => (call.init!.headers as Record<string, string>).Authorization === 'Bearer a')).toBe(true);
  });
  it('surfaces the reason the API gives', async () => {
    const { session } = await admin({ '/api/admin/users': () => json({ detail: 'Only administrators can manage users and licences' }, 403) });
    await expect(session.adminUsers()).rejects.toThrow('Only administrators can manage users and licences');
  });
});

describe('PKCE pair', () => {
  it('matches RFC 7636 for a fixed verifier source', async () => {
    const bytes = new Uint8Array(48).map((_, index) => index);
    const pair = await pkcePair({ getRandomValues: ((array: Uint8Array) => { array.set(bytes); return array; }) as Crypto['getRandomValues'], subtle: webcrypto.subtle as SubtleCrypto });
    expect(pair.verifier).toBe(Buffer.from(bytes).toString('base64url'));
    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'));
  });
});

describe('shell wiring (SC-0137)', () => {
  const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
  it('shows the Admin menu only to administrators and never a token in the page', () => {
    const menu = template.slice(template.indexOf('@if (session.isAdmin())'), template.indexOf('</details>', template.indexOf('@if (session.isAdmin())')));
    expect(menu).toContain('openAdmin(category.id)');
    expect(template).toContain('@switch (session.state())');
    // No token of the session reaches the page; the External tokens category only shows a state.
    expect(template).not.toMatch(/access_token|refresh_token|\.tokens\b|idToken/);
    expect(template).not.toMatch(/\bconfirm\(\s*["']/);
  });
});

describe('administration workspace', () => {
  async function workspace() {
    const { AppComponent } = await import('../src/app/app.component');
    const { signal, computed } = await import('@angular/core');
    const sent: unknown[][] = [];
    const user = { id: 'u1', username: 'ana', firstName: 'Ana', lastName: 'Diaz', name: 'Ana Diaz', email: 'ana@example.test', enabled: true, admin: false,
      created: '2026-09-01T10:00:00Z', lastLogin: null, documents: 2, ban: null, licence: { state: 'none', expires: null, permissions: [], tier: null } };
    const dialog = Object.create(AppComponent.prototype);
    Object.assign(dialog, {
      locale: signal('en'), adminCategory: signal('users'), adminUserList: signal([user]), adminRoleList: signal([]), adminLicenceList: signal([]),
      adminDocumentList: signal([]), adminSelectedId: signal('u1'), adminCreating: signal(false), adminBusy: signal(false), adminError: signal(''),
      adminNotice: signal(''), confirmation: signal(null), licencePermissions: [{ id: 'ai-tools', label: 'AI Tools' }, { id: 'change-control', label: 'Change control' }],
      passwordDraft: { password: 'New-Pass-123', temporary: true }, banDraft: { mode: 'temporary', until: '', reason: '' },
      licenceDraft: { userId: '', tier: 'pro', permissions: { 'ai-tools': false, 'change-control': false }, period: 'days', days: 30, until: '' },
      session: new Proxy({}, { get: (_target, name: string) => async (...args: unknown[]) => { sent.push([name, ...args]); return name === 'adminUsers' ? [user] : user; } }),
    });
    dialog.adminUsersById = computed(() => new Map(dialog.adminUserList().map((item: typeof user) => [item.id, item])));
    dialog.adminSelectedUser = computed(() => dialog.adminUsersById().get(dialog.adminSelectedId()) ?? null);
    return { dialog, sent };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('asks before overwriting a password and sends nothing when cancelled', async () => {
    const { dialog, sent } = await workspace();
    dialog.overwritePassword();
    expect(dialog.confirmation()).toMatchObject({ title: 'Overwrite the password', message: 'The password of Ana Diaz is replaced and their sessions end.', action: 'Overwrite' });
    dialog.confirmation.set(null);
    expect(sent).toEqual([]);
    dialog.overwritePassword();
    dialog.confirm();
    await settle(); await settle();
    expect(sent[0]).toEqual(['setPassword', 'u1', 'New-Pass-123', true]);
    expect(dialog.adminNotice()).toBe('The password was overwritten.');
  });

  it('bans until the chosen date, as an instant, only after confirmation', async () => {
    const { dialog, sent } = await workspace();
    dialog.banUser();
    expect(dialog.adminError()).toBe('Choose when the ban ends.');
    dialog.banDraft = { mode: 'temporary', until: '2026-10-01T12:30', reason: 'abuse' };
    dialog.banUser();
    expect(dialog.confirmation().title).toBe('Ban the user');
    dialog.confirm();
    await settle(); await settle();
    expect(sent[0]).toEqual(['banUser', 'u1', new Date('2026-10-01T12:30').toISOString(), 'abuse']);
    dialog.banDraft = { mode: 'permanent', until: '', reason: '' };
    dialog.banUser(); dialog.confirm();
    await settle(); await settle();
    expect(sent.filter((call) => call[0] === 'banUser').at(-1)).toEqual(['banUser', 'u1', null, '']);
  });

  it('issues a licence only with a holder and a permission', async () => {
    const { dialog, sent } = await workspace();
    dialog.issueLicence();
    expect(dialog.adminError()).toBe('Choose the holder of the licence.');
    dialog.licenceDraft.userId = 'u1';
    dialog.issueLicence();
    expect(dialog.adminError()).toBe('Choose at least one permission.');
    dialog.licenceDraft = { userId: 'u1', tier: 'teams', permissions: { 'ai-tools': true, 'change-control': true }, period: 'until', days: 30, until: '2026-12-31' };
    dialog.issueLicence();
    await settle(); await settle();
    expect(sent[0]).toEqual(['issueLicence', 'u1', 'teams', ['ai-tools', 'change-control'], { until: '2026-12-31' }]);
  });

  it('shows dates short with the full date, time and zone on hover', async () => {
    const { dialog } = await workspace();
    expect(dialog.shortDate('2026-09-01T10:00:00Z')).toBe('01/09/26');
    expect(dialog.shortDate(null, 'Never')).toBe('Never');
    expect(dialog.fullDate('2026-09-01T10:00:00Z')).toContain('2026');
    expect(dialog.fullDate('2026-09-01T10:00:00Z')).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(dialog.fullDate(null)).toBe('');
    expect(dialog.formatSize(512)).toBe('512 B');
    expect(dialog.formatSize(2048)).toBe('2.0 KB');
    expect(dialog.formatSize(3 * 1048576)).toBe('3.0 MB');
  });
});

describe('session edge cases', () => {
  it('runs the scheduled renewal, which reloads the session', async () => {
    let issued = 0;
    const world = environment({
      '/api/identity': configured,
      [ISSUER + '/protocol/openid-connect/token']: () => tokens({ access_token: 'access-' + ++issued }),
      '/api/session': () => json(SESSION),
    }, 'http://localhost:8090/?state=s1&code=c1');
    world.store.set('xds-session-pending', JSON.stringify({ state: 's1', verifier: 'v'.repeat(64), redirect: 'http://localhost:8090/' }));
    const session = service(world.env);
    await session.start();
    world.timers.at(-1)!.handler();
    await new Promise((resolve) => setTimeout(resolve));
    const sessions = world.calls.filter((call) => call.url === '/api/session');
    expect((sessions.at(-1)!.init!.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
  });

  it('ignores corrupt storage and a callback without a pending sign-in', async () => {
    const world = environment({ '/api/identity': configured }, 'http://localhost:8090/?error=access_denied&state=s1');
    world.store.set('xds-session-tokens', '{not json');
    world.store.set('xds-session-pending', '[1, 2]');
    const session = service(world.env);
    await session.start();
    expect([session.state(), session.message()]).toEqual(['signed-out', 'The sign-in could not be verified; sign in again.']);
    const resumed = environment({ '/api/identity': configured });
    resumed.store.set('xds-session-tokens', '{not json');
    const second = service(resumed.env);
    await second.start();
    expect(second.state()).toBe('signed-out');
  });

  it('refuses a token answer that is not accepted, and a renewal without a refresh token', async () => {
    const world = environment({ '/api/identity': configured, [ISSUER + '/protocol/openid-connect/token']: () => new Response('no', { status: 400 }) },
      'http://localhost:8090/?state=s1&code=c1');
    world.store.set('xds-session-pending', JSON.stringify({ state: 's1', verifier: 'v'.repeat(64), redirect: 'http://localhost:8090/' }));
    const session = service(world.env);
    await session.start();
    expect(session.message()).toBe('Sign-in failed; sign in again.');
    expect(await session.refresh()).toBe(false);
    expect(session.message()).toBe('Your sign-in has ended; sign in again.');
  });

  it('reports an unreachable API and a refusal without a readable reason', async () => {
    const world = environment({ '/api/identity': configured, '/api/session': () => json({ ...SESSION, admin: true }), '/api/admin/users': () => new Response('<html>', { status: 502 }) });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: '', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    await expect(session.adminUsers()).rejects.toThrow('The server refused the request (502).');
    await expect(session.adminRoles()).rejects.toThrow('The server is unreachable.');
    session.signOut();
    expect(new URL(world.assigned[0]).searchParams.has('id_token_hint')).toBe(false);
    await expect(session.revokeLicence('u1')).rejects.toThrow('Sign in to use advanced capabilities.');
  });

  it('signs out without leaving the page when advanced mode is not configured', async () => {
    const world = environment({ '/api/identity': () => json({ configured: false }) });
    const session = service(world.env);
    await session.start();
    session.signOut();
    expect([session.state(), world.assigned]).toEqual(['not-configured', []]);
  });

  it('uses the browser by default', async () => {
    const session = new SessionService();
    const answers: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => { answers.push(String(input)); return json({ configured: false }); }) as typeof fetch;
    try {
      await session.start();
    } finally {
      globalThis.fetch = original;
    }
    expect(answers).toEqual(['/api/identity']);
    expect(session.state()).toBe('not-configured');
  });
});

describe('super administrator, suspension and the advanced tools block (SC-0147, SC-0145)', () => {
  async function signedIn(licence: object, admin = false) {
    const world = environment({ '/api/identity': configured, '/api/session': () => json({ ...SESSION, admin, licence }) });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    return session;
  }
  it('works in licensed mode as super administrator and with a valid licence only', async () => {
    const admin = await signedIn({ state: 'unrestricted', expires: null, permissions: ['ai-tools', 'change-control'] }, true);
    expect([admin.licensed(), admin.capability('ai-tools').allowed, admin.capability('change-control').allowed]).toEqual([true, true, true]);
    const suspended = await signedIn({ state: 'suspended', expires: '2026-12-01T00:00:00Z', permissions: [] });
    expect([suspended.licensed(), suspended.capability('ai-tools').reason]).toEqual([false, 'Your licence is suspended.']);
    const valid = await signedIn(SESSION.licence);
    expect(valid.licensed()).toBe(true);
    const demo = service(environment({ '/api/identity': () => json({ configured: false }) }).env);
    await demo.start();
    expect(demo.licensed()).toBe(false);
  });
  it('shows the block apart from the drawing tools, with its own icons', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    const rail = template.slice(template.indexOf('<aside class="toolrail"'), template.indexOf('<div class="rail-palette"'));
    expect(rail).toContain('class="tool-section advanced-tools"');
    expect(rail).toContain('(click)="openAdvancedTool(tool)"');
    expect(rail).toContain('[class.locked]="!session.capability(tool.permission).allowed"');
    const source = readFileSync('apps/web/src/app/app.component.ts', 'utf-8');
    for (const icon of ['ai-tools', 'change-control']) {
      expect(source).toContain(`icon: "${icon}"`);
      expect(readFileSync(`apps/web/public/assets/icons/${icon}.svg`, 'utf-8')).toContain('<svg');
    }
  });
});

describe('expired access tokens', () => {
  it('renews the token once when the API answers that it expired, and tries again', async () => {
    let calls = 0;
    const world = environment({
      '/api/identity': configured,
      [ISSUER + '/protocol/openid-connect/token']: () => tokens({ access_token: 'fresh' }),
      '/api/session': () => json(SESSION),
      '/api/me/tokens/openai/test': (call) => (++calls === 1 ? json({ detail: 'The sign-in has expired' }, 401)
        : json({ provider: 'openai', ok: (call.init!.headers as Record<string, string>).Authorization === 'Bearer fresh', detail: 'OpenAI accepted the token' })),
    });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'stale', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    expect(await session.testToken()).toEqual({ provider: 'openai', ok: true, detail: 'OpenAI accepted the token' });
    expect(calls).toBe(2);
  });

  it('gives up after one renewal and reports the refusal', async () => {
    const world = environment({
      '/api/identity': configured,
      [ISSUER + '/protocol/openid-connect/token']: () => tokens(),
      '/api/session': () => json(SESSION),
      '/api/me/tokens/openai': () => json({ detail: 'The sign-in has expired' }, 401),
    });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'stale', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    await expect(session.tokenStatus()).rejects.toThrow('The sign-in has expired');
    expect(world.calls.filter((call) => call.url === '/api/me/tokens/openai')).toHaveLength(2);
  });
});

describe('token form feedback', () => {
  it('says what it is doing while testing and how the test ended', async () => {
    const { AppComponent } = await import('../src/app/app.component');
    const { signal } = await import('@angular/core');
    let resolve!: (value: { ok: boolean; detail: string }) => void;
    const form = Object.assign(Object.create(AppComponent.prototype), {
      tokenState: signal({ provider: 'openai', configured: true, updatedAt: null }), tokenMessage: signal(''), tokenBusy: signal(''), tokenOutcome: signal(''),
      session: { testToken: () => new Promise((done) => { resolve = done; }) },
    });
    const running = form.testToken();
    expect([form.tokenBusy(), form.tokenMessage(), form.tokenOutcome()]).toEqual(['testing', 'Contacting OpenAI with your token…', '']);
    resolve({ ok: false, detail: 'OpenAI refused the token' });
    await running;
    expect([form.tokenBusy(), form.tokenMessage(), form.tokenOutcome()]).toEqual(['', 'OpenAI refused the token', 'error']);
  });
});

describe('tier colours', () => {
  it('gives the header badge the tone of the tier, Pro blue for the super administrator, and no red to any tier', async () => {
    const { AppComponent } = await import('../src/app/app.component');
    const { signal } = await import('@angular/core');
    const badge = (licensed: boolean, tier: string | null, admin: boolean) => Object.assign(Object.create(AppComponent.prototype), {
      session: { licensed: () => licensed, isAdmin: () => admin, session: () => ({ licence: { tier } }) }, locale: signal('en'),
    });
    expect(badge(false, null, false).modeTone()).toBe('demo');
    expect(badge(true, null, true).modeTone()).toBe('pro');
    expect(badge(true, 'studio', false).modeTone()).toBe('studio');
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf-8');
    const tones = [...styles.matchAll(/\[data-tone="(\w+)"\] \{ --tone: (#[0-9a-f]{6}); \}/g)].map(([, name, colour]) => [name, colour]);
    expect(Object.fromEntries(tones).pro).toBe('#3979ff');
    expect(tones.map(([, colour]) => colour)).not.toContain('#e5484d');
  });
});

describe('destructive actions', () => {
  it('draws every deleting action with the red trash icon', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    for (const call of ['editor.remove()', 'deleteSwatch()', 'deleteUser()', 'deleteDocument()', 'removeToken()']) {
      const at = template.indexOf(`(click)="${call}"`);
      const tag = template.slice(template.lastIndexOf('<button', at), template.indexOf('</button>', at));
      expect(tag, call).toContain('destructive');
      expect(tag, call).toContain('delete-danger.svg');
    }
    expect(template).toContain('[class.destructive-option]="action.destructive"');
    expect(template).toContain('@if (pending.deletes)');
    const menu = readFileSync('apps/web/src/app/context-menu.component.html', 'utf-8');
    expect(menu).toContain('[class.destructive]="entry.destructive"');
    expect(readFileSync('apps/web/public/assets/icons/delete-danger.svg', 'utf-8')).toContain('#e5484d');
  });
});

describe('streamed generation (FEAT-0029, SC-0154)', () => {
  /** A response whose body arrives in the given chunks, as a proxy passes a stream on. */
  const streamed = (chunks: string[]) => new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  async function signedIn(answer: () => Response) {
    const world = environment({ '/api/identity': configured, '/api/session': () => json(SESSION), '/api/ai/generate': answer });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: 'i', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    return { session, world };
  }
  const request = { prompt: 'red', action: 'style' as const, scope: 'selection' as const, creativity: 0.5 };

  it('reports each model tried and returns the result, whatever the chunks', async () => {
    const { session, world } = await signedIn(() => streamed(['{"type":"trying","model":"gpt-6-sol"}\n{"type":"try', 'ing","model":"gpt-6-luna"}\n{"type":"waiting"}\n',
      '{"type":"result","kind":"svg","svg":"<svg/>","model":"gpt-6-luna"}\n']));
    const events: unknown[] = [];
    expect(await session.generate(request, undefined, (event) => events.push(event))).toEqual({ kind: 'svg', svg: '<svg/>', model: 'gpt-6-luna' });
    expect(events).toEqual([{ type: 'trying', model: 'gpt-6-sol' }, { type: 'trying', model: 'gpt-6-luna' }, { type: 'waiting' }]);
    const sent = world.calls.find((call) => call.url === '/api/ai/generate')!;
    expect((sent.init!.headers as Record<string, string>).Accept).toBe('application/x-ndjson');
  });

  it('throws the reason of a streamed refusal, or of a stream that ends without a result', async () => {
    const refused = await signedIn(() => streamed(['{"type":"trying","model":"gpt-6-sol"}\n{"type":"error","status":502,"detail":"No model"}\n']));
    await expect(refused.session.generate(request)).rejects.toThrow('No model');
    const cut = await signedIn(() => streamed(['{"type":"trying","model":"gpt-6-sol"}\n']));
    await expect(cut.session.generate(request)).rejects.toThrow('The server closed the request without a result.');
  });

  it('still reads a plain answer and the reason of a refusal before the stream', async () => {
    const plain = await signedIn(() => json({ kind: 'image', png: 'data:image/png;base64,AAAA' }));
    expect(await plain.session.generate(request)).toEqual({ kind: 'image', png: 'data:image/png;base64,AAAA' });
    const early = await signedIn(() => json({ detail: 'Write what the model should do' }, 422));
    await expect(early.session.generate(request)).rejects.toThrow('Write what the model should do');
  });
});
