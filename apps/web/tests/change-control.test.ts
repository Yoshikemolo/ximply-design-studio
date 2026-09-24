// @vitest-environment happy-dom
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { EditorService } from '../src/app/editor.service';
import { ChangeControlService, stableJson, type VcsStatus } from '../src/app/change-control.service';
import type { SessionService } from '../src/app/session.service';
import { newLayer, type Layer, type StudioDocument } from '../../../packages/domain/src/document';

beforeEach(() => {
  localStorage.clear();
  const canvases = new WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvas>>();
  const native = (element: HTMLCanvasElement) => {
    let canvas = canvases.get(element);
    if (!canvas) { canvas = createCanvas(element.width, element.height); canvases.set(element, canvas); }
    return canvas;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) { return native(this).getContext('2d') as never; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function(this: HTMLCanvasElement) { return native(this).toDataURL('image/png'); });
});
afterEach(() => vi.restoreAllMocks());

const rect = (id: string, fill = '#3366ff'): Layer => ({ ...newLayer('rectangle', id, { x: 10, y: 10 }), width: 400, height: 200, fill });
const status = (extra: Partial<VcsStatus> = {}): VcsStatus => ({ branch: 'main', head: 'b'.repeat(40), upstream: 'origin/main', ahead: 0, behind: 0,
  merging: false, conflicts: [], changes: [], canUndo: false, canRedo: false, ...extra });

/** A contract double of the change control routes, answering from a small in-memory history. */
class FakeRepository {
  calls: { path: string; method: string; body?: any }[] = [];
  document: StudioDocument;
  state = status();
  fail: Record<string, string> = {};
  constructor(document: StudioDocument) { this.document = document; }
  async vcs(path: string, method = 'GET', body?: any): Promise<any> {
    this.calls.push({ path, method, body });
    const key = path.replace(/^\/projects\/p1/, '').split('?')[0];
    if (this.fail[key]) throw new Error(this.fail[key]);
    const answer = (result: unknown, moved = false) => ({ result, status: this.state, moved });
    switch (method + ' ' + key) {
      case 'GET /projects': return { projects: [{ id: 'p1', name: 'Poster', createdBy: 'u', createdAt: '2026-09-24T10:00:00Z' }] };
      case 'POST /projects': return { id: 'p1', name: body.name, createdBy: 'u', createdAt: '2026-09-24T10:00:00Z' };
      case 'GET /status': return this.state;
      case 'GET /log': return { commits: [{ sha: 'b'.repeat(40), parents: ['a'.repeat(40)], author: 'Ana', email: 'a@x', date: '2026-09-24T10:00:00Z', subject: 'Blue' },
        { sha: 'a'.repeat(40), parents: [], author: 'Ana', email: 'a@x', date: '2026-09-23T10:00:00Z', subject: 'Create' }],
        refs: [{ name: 'main', sha: 'b'.repeat(40), kind: 'local' }, { name: 'origin/main', sha: 'a'.repeat(40), kind: 'remote' }], truncated: false, comments: { ['a'.repeat(40)]: 2 } };
      case 'GET /document': return { document: this.document, head: this.state.head };
      case 'POST /commit': this.state = status({ ahead: 1, canUndo: true }); return answer('c'.repeat(40), true);
      case 'POST /checkout': this.document = { ...this.document, layers: [rect('other', '#00ff00')] }; return answer(null, true);
      case 'POST /undo': this.document = { ...this.document, layers: [rect('shape')] }; return answer({ operation: 'commit' }, true);
      case 'POST /merge': this.state = status({ merging: true, conflicts: ['documents/main.xds.json'] }); return answer({ conflicts: ['documents/main.xds.json'] }, false);
      case 'POST /push': return answer(null);
      default:
        if (key.endsWith('/thumbnail')) return { png: 'data:image/png;base64,AAAA' };
        if (key.endsWith('/comments') && method === 'GET') return { comments: [] };
        if (key.endsWith('/comments')) return { id: 'k1', subject: 'u', author: 'Ana', text: body.text, createdAt: '2026-09-24T10:00:00Z' };
        if (method === 'GET' && key.startsWith('/commits/')) return { sha: key.slice(9), parents: [], author: 'Ana', email: 'a@x', date: '', message: 'Blue', files: [] };
        throw new Error('unexpected ' + method + ' ' + key);
    }
  }
}

function setup() {
  const editor = new EditorService();
  editor.document.update((d) => ({ ...d, name: 'Poster', layers: [rect('shape')] }));
  const repository = new FakeRepository(editor.document());
  const vcs = new ChangeControlService(editor, repository as unknown as SessionService);
  return { editor, repository, vcs };
}

describe('projects and commits (FEAT-0031, SC-0125, SC-0127, SC-0155)', () => {
  it('makes a project of the open document with a thumbnail and links its tab', async () => {
    const { editor, repository, vcs } = setup();
    expect(await vcs.createProject(' Poster ')).toBe(true);
    const created = repository.calls.find((call) => call.method === 'POST' && call.path === '/projects')!;
    expect(created.body.name).toBe('Poster');
    expect(created.body.document.layers[0].id).toBe('shape');
    expect(created.body.thumbnail).toMatch(/^data:image\/png;base64,/);
    expect(vcs.linkedTab()).toBe(editor.activeTabId());
    expect(vcs.dirty()).toBe(false);
    editor.document.update((d) => ({ ...d, layers: [rect('shape', '#ff0000')] }));
    expect(vcs.dirty()).toBe(true);
  });

  it('commits the linked document and clears the changes mark', async () => {
    const { editor, repository, vcs } = setup();
    await vcs.createProject('Poster');
    editor.document.update((d) => ({ ...d, layers: [rect('shape', '#ff0000')] }));
    expect(await vcs.commit('  ')).toBe(false);
    expect(vcs.outcome()?.text).toBe('Write a message for the commit.');
    expect(await vcs.commit('Red')).toBe(true);
    const sent = repository.calls.find((call) => call.path === '/projects/p1/commit')!;
    expect([sent.body.message, sent.body.document.layers[0].fill]).toEqual(['Red', '#ff0000']);
    expect(sent.body.thumbnail).toMatch(/^data:image\/png/);
    expect(vcs.dirty()).toBe(false);
    expect(vcs.status()?.ahead).toBe(1);
  });

  it('reports a refusal of the API without changing anything', async () => {
    const { repository, vcs } = setup();
    await vcs.createProject('Poster');
    repository.fail['/push'] = 'The shared repository has newer commits; pull first';
    expect(await vcs.push()).toBe(false);
    expect(vcs.outcome()).toEqual({ ok: false, text: 'The shared repository has newer commits; pull first' });
    expect(vcs.busy()).toBe('');
  });
});

describe('operations that move HEAD (FEAT-0031, SC-0128, SC-0129, SC-0131)', () => {
  it('reloads the document into the linked tab after a checkout, as one undo step', async () => {
    const { editor, vcs } = setup();
    await vcs.createProject('Poster');
    expect(await vcs.checkout('feature')).toBe(true);
    expect(editor.document().layers.map((layer) => layer.id)).toEqual(['other']);
    expect(vcs.dirty()).toBe(false);
    editor.undo();
    expect(editor.document().layers.map((layer) => layer.id)).toEqual(['shape']);
  });

  it('asks before replacing uncommitted changes, and keeps them when a commit is undone', async () => {
    const { editor, vcs } = setup();
    await vcs.createProject('Poster');
    editor.document.update((d) => ({ ...d, layers: [rect('shape', '#ff0000')] }));
    expect(vcs.replacesDocument('checkout')).toBe(true);
    await vcs.commit('Red');
    expect(vcs.replacesDocument('checkout')).toBe(false);
    await vcs.undo();
    expect(editor.document().layers[0].fill).toBe('#ff0000');
    expect(vcs.dirty()).toBe(true);
  });

  it('shows conflicts and leaves the document alone during a conflicted merge', async () => {
    const { editor, vcs } = setup();
    await vcs.createProject('Poster');
    await vcs.merge('feature');
    expect(vcs.status()?.conflicts).toEqual(['documents/main.xds.json']);
    expect(vcs.outcome()).toEqual({ ok: false, text: 'The merge has conflicts: choose a side for each file, or abort it.' });
    expect(editor.document().layers[0].id).toBe('shape');
  });
});

describe('graph, thumbnails and comments (FEAT-0031, SC-0126, SC-0155, SC-0156)', () => {
  it('lays out the history with branches, HEAD and comment counts', async () => {
    const { vcs } = setup();
    await vcs.createProject('Poster');
    const rows = vcs.rows();
    expect(rows.map((row) => [row.commit.subject, row.head, row.refs.map((ref) => ref.name), row.comments])).toEqual([
      ['Blue', true, ['main'], 0], ['Create', false, ['origin/main'], 2]]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0]);
  });

  it('fetches a thumbnail once per commit', async () => {
    const { repository, vcs } = setup();
    await vcs.createProject('Poster');
    await vcs.thumbnail('a'.repeat(40));
    await vcs.thumbnail('a'.repeat(40));
    expect(repository.calls.filter((call) => call.path.endsWith('/thumbnail'))).toHaveLength(1);
    expect(vcs.thumbnails()['a'.repeat(40)]).toBe('data:image/png;base64,AAAA');
  });

  it('adds a comment to the selected commit and counts it', async () => {
    const { vcs } = setup();
    await vcs.createProject('Poster');
    await vcs.select('b'.repeat(40));
    expect(await vcs.addComment('  Looks good ')).toBe(true);
    expect(vcs.comments().map((comment) => comment.text)).toEqual(['Looks good']);
    expect(vcs.rows()[0].comments).toBe(1);
    expect(await vcs.addComment('   ')).toBe(false);
  });

  it('compares documents whatever the order of their keys', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(stableJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});
