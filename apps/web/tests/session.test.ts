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
    const { session, world } = await admin({ '/api/admin/users': () => json({ total: 1, page: 0, size: 20, users: [user] }) });
    expect(session.isAdmin()).toBe(true);
    expect((await session.adminUsers('an a', 2)).total).toBe(1);
    await session.issueLicence('u 1', ['ai-tools'], { days: 30 });
    await session.issueLicence('u 1', ['change-control'], { until: '2026-12-31' });
    await session.extendLicence('u 1', 10);
    await session.revokeLicence('u 1');
    const sent = world.calls.filter((call) => call.url.startsWith('/api/admin')).map((call) => [call.init?.method ?? 'GET', call.url, call.init?.body ?? null]);
    expect(sent).toEqual([
      ['GET', '/api/admin/users?search=an+a&page=2&size=20', null],
      ['PUT', '/api/admin/users/u%201/licence', '{"permissions":["ai-tools"],"days":30}'],
      ['PUT', '/api/admin/users/u%201/licence', '{"permissions":["change-control"],"until":"2026-12-31"}'],
      ['POST', '/api/admin/users/u%201/licence/extend', '{"days":10}'],
      ['DELETE', '/api/admin/users/u%201/licence', null],
    ]);
    expect(world.calls.filter((call) => call.url.startsWith('/api/admin')).every((call) => (call.init!.headers as Record<string, string>).Authorization === 'Bearer a')).toBe(true);
  });
  it('surfaces the reason the API gives', async () => {
    const { session } = await admin({ '/api/admin/users': () => json({ detail: 'Only administrators can manage users and licences' }, 403) });
    await expect(session.adminUsers('', 0)).rejects.toThrow('Only administrators can manage users and licences');
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
    expect(menu).toContain('openAdmin()');
    expect(template).toContain('@switch (session.state())');
    expect(template).not.toMatch(/access_token|refresh_token|tokens\b/);
    expect(template).not.toMatch(/\bconfirm\(\s*["']/);
  });
});

describe('users and licences dialog', () => {
  it('asks for a permission, sends the chosen period and revokes only on the second press', async () => {
    const { AppComponent } = await import('../src/app/app.component');
    const { signal } = await import('@angular/core');
    const sent: unknown[][] = [];
    const user = { id: 'u1', username: 'ana', name: 'Ana', email: '', enabled: true, licence: { state: 'valid', expires: '2026-10-23T10:00:00Z', permissions: ['ai-tools'] } };
    const dialog = Object.assign(Object.create(AppComponent.prototype), {
      adminSelected: signal(user), adminError: signal(''), adminBusy: signal(false), adminConfirmRevoke: signal(false),
      adminPage: signal({ total: 1, page: 0, size: 20, users: [user] }),
      licencePermissions: [{ id: 'ai-tools', label: 'AI Tools' }, { id: 'change-control', label: 'Change control' }],
      adminDraft: { permissions: { 'ai-tools': false, 'change-control': false }, period: 'days', days: 30, until: '', extendDays: 7 },
      session: {
        issueLicence: async (...args: unknown[]) => { sent.push(['issue', ...args]); return { ...user, licence: { ...user.licence, permissions: ['change-control'] } }; },
        revokeLicence: async (...args: unknown[]) => { sent.push(['revoke', ...args]); return { ...user, licence: { state: 'none', expires: null, permissions: [] } }; },
        extendLicence: async (...args: unknown[]) => { sent.push(['extend', ...args]); return user; },
      },
    });
    dialog.issueLicence();
    expect(dialog.adminError()).toBe('Choose at least one permission.');
    dialog.adminDraft.permissions['change-control'] = true;
    dialog.adminDraft.period = 'until'; dialog.adminDraft.until = '2026-12-31';
    dialog.issueLicence();
    dialog.extendLicence();
    await new Promise((resolve) => setTimeout(resolve));
    dialog.revokeLicence();
    expect(dialog.adminConfirmRevoke()).toBe(true);
    dialog.revokeLicence();
    await new Promise((resolve) => setTimeout(resolve));
    expect(sent).toEqual([['issue', 'u1', ['change-control'], { until: '2026-12-31' }], ['extend', 'u1', 7], ['revoke', 'u1']]);
    expect(dialog.adminPage().users[0].licence.state).toBe('none');
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
    const world = environment({ '/api/identity': configured, '/api/session': () => json({ ...SESSION, admin: true }), '/api/admin/users?': () => new Response('<html>', { status: 502 }) });
    world.store.set('xds-session-tokens', JSON.stringify({ access: 'a', refresh: 'r', idToken: '', expiresAt: 2_000_000 }));
    const session = service(world.env);
    await session.start();
    await expect(session.adminUsers('', 0)).rejects.toThrow('The server refused the request (502).');
    await expect(session.extendLicence('u1', 5)).rejects.toThrow('The server is unreachable.');
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
