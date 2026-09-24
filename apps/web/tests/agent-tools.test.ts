// @vitest-environment happy-dom
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { EditorService } from '../src/app/editor.service';
import { AgentToolsService, describe as describeRequest } from '../src/app/agent-tools.service';
import type { SessionService } from '../src/app/session.service';
import { newLayer, type Layer } from '../../../packages/domain/src/document';
import type { AgentRequest, AgentResult, SavedPrompt } from '../../../packages/domain/src/agent-prompts';

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

const rect = (id: string, x: number, y: number, width: number, height: number, extra: Partial<Layer> = {}): Layer =>
  ({ ...newLayer('rectangle', id, { x, y }), width, height, fill: '#3366ff', ...extra });
/** A real 20 x 10 PNG, as the model would return it. */
const picture = () => createCanvas(20, 10).toDataURL('image/png');

class FakeSession {
  requests: AgentRequest[] = [];
  stored: SavedPrompt[] = [];
  answer: () => Promise<AgentResult> = async () => ({ kind: 'image', png: picture() });
  failSaving = false;
  generate(request: AgentRequest, signal?: AbortSignal): Promise<AgentResult> {
    this.requests.push(request);
    if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      this.answer().then(resolve, reject);
    });
  }
  async savedPrompts() { return this.stored; }
  async savePrompts(prompts: SavedPrompt[]) {
    if (this.failSaving) throw new Error('The server is unreachable.');
    this.stored = prompts;
    return prompts;
  }
}

function setup(layers: Layer[], selected: string[]) {
  const editor = new EditorService();
  editor.document.update((d) => ({ ...d, layers }));
  editor.selectedIds.set(selected); editor.selectedId.set(selected[0] ?? null);
  const session = new FakeSession();
  const tools = new AgentToolsService(editor, session as unknown as SessionService);
  return { editor, session, tools };
}

describe('sending the context (FEAT-0029, SC-0150, SC-0151)', () => {
  it('sends the prompt, the selection as data and PNG, the document PNG and the modifiers', async () => {
    const { session, tools } = setup([rect('a', 10, 10, 40, 20), rect('b', 100, 100, 10, 10)], ['a']);
    tools.action.set('style'); tools.prompt.set(' watercolour '); tools.setCreativity(0.8);
    expect(await tools.generate()).toBe(true);
    const [request] = session.requests;
    expect(request).toMatchObject({ prompt: 'watercolour', action: 'style', scope: 'selection', creativity: 0.8 });
    expect(request.selectionPng).toMatch(/^data:image\/png;base64,/);
    expect(request.documentPng).toMatch(/^data:image\/png;base64,/);
    expect(JSON.parse(request.selectionData!).map((layer: Layer) => layer.id)).toEqual(['a']);
    expect(Object.keys(request)).not.toContain('frame');
    expect(describeRequest(request).map((item) => item.label)).toEqual(['Prompt', 'Selected objects as data', 'Selection as PNG', 'Whole document as PNG', 'Modifiers']);
  });

  it('sends only the document when it is the context', async () => {
    const { session, tools } = setup([rect('a', 10, 10, 40, 20)], []);
    tools.scope.set('document'); tools.action.set('enhance');
    await tools.generate();
    expect(session.requests[0].selectionPng).toBeUndefined();
    expect(session.requests[0].selectionData).toBeUndefined();
    expect(session.requests[0].documentPng).toMatch(/^data:image\/png/);
  });

  it('sends nothing and explains why when the request is incomplete', async () => {
    const { session, tools } = setup([rect('a', 10, 10, 40, 20)], []);
    tools.action.set('enhance');
    expect(await tools.generate()).toBe(false);
    expect(tools.outcome()).toEqual({ ok: false, text: 'Select objects, or choose the whole document as the context.' });
    tools.scope.set('document'); tools.action.set('style');
    expect(await tools.generate()).toBe(false);
    expect(tools.outcome()?.text).toBe('Write what the model should do.');
    expect(session.requests).toEqual([]);
  });
});

describe('inserting the result (FEAT-0029, SC-0153)', () => {
  it('inserts the picture as a new object fitted into the selection, above it, as one undo step', async () => {
    const { editor, tools } = setup([rect('a', 10, 10, 40, 20), rect('b', 100, 100, 10, 10)], ['a']);
    tools.action.set('enhance');
    await tools.generate();
    const layers = editor.document().layers;
    expect(layers.map((layer) => layer.id).slice(0, 1)).toEqual(['a']);
    expect(layers).toHaveLength(3);
    const created = layers[1];
    // The frame is the visual bounds, the 2 px stroke included: 9, 9, 42 x 22; the 2:1 picture fits it by width.
    expect(created).toMatchObject({ kind: 'image', x: 9, y: 9.5, width: 42, height: 21, name: 'Improve quality' });
    expect(editor.selectedIds()).toEqual([created.id]);
    expect(tools.outcome()).toEqual({ ok: true, text: 'The result was inserted as a new object.' });
    editor.undo();
    expect(editor.document().layers.map((layer) => layer.id)).toEqual(['a', 'b']);
  });

  it('places the result outside the groups of the selection', async () => {
    const { editor, tools } = setup([rect('a', 0, 0, 20, 20, { groupPath: ['G'] }), rect('c', 0, 0, 20, 20, { groupPath: ['G'] }), rect('d', 50, 50, 5, 5)], ['a']);
    tools.action.set('enhance');
    await tools.generate();
    const layers = editor.document().layers;
    expect(layers.map((layer) => layer.id).slice(0, 2)).toEqual(['a', 'c']);
    expect(layers[2].groupPath ?? []).toEqual([]);
  });

  it('inserts a drawing as editable paths fitted into the frame', async () => {
    const { editor, session, tools } = setup([rect('a', 100, 100, 50, 50)], ['a']);
    session.answer = async () => ({ kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#f00"/><path d="M0 0L10 10" stroke="#000"/></svg>' });
    tools.action.set('vectorize');
    expect(await tools.generate()).toBe(true);
    const created = editor.document().layers.filter((layer) => layer.id !== 'a');
    expect(created.length).toBeGreaterThanOrEqual(2);
    expect(created.every((layer) => layer.kind !== 'image')).toBe(true);
    expect(editor.selectedIds()).toEqual(created.map((layer) => layer.id));
    expect(tools.outcome()?.text).toBe('The result was inserted as editable paths.');
  });

  it('reports a refusal of the API and inserts nothing', async () => {
    const { editor, session, tools } = setup([rect('a', 0, 0, 10, 10)], ['a']);
    session.answer = async () => { throw new Error('Save your OpenAI API token in Settings > External tokens first'); };
    tools.action.set('enhance');
    expect(await tools.generate()).toBe(false);
    expect(tools.outcome()).toEqual({ ok: false, text: 'Save your OpenAI API token in Settings > External tokens first' });
    expect(editor.document().layers).toHaveLength(1);
    expect(tools.phase()).toBe('idle');
  });

  it('cancels a request on its way', async () => {
    const { editor, session, tools } = setup([rect('a', 0, 0, 10, 10)], ['a']);
    session.answer = () => new Promise(() => undefined);
    tools.action.set('enhance');
    const running = tools.generate();
    await vi.waitFor(() => expect(session.requests).toHaveLength(1));
    expect(tools.busy()).toBe(true);
    tools.cancel();
    expect(await running).toBe(false);
    expect(tools.outcome()?.text).toBe('The request was cancelled.');
    expect(editor.document().layers).toHaveLength(1);
  });

  it('repeats the last request with the same context and choices', async () => {
    const { editor, session, tools } = setup([rect('a', 0, 0, 10, 10)], ['a']);
    tools.action.set('upscale');
    expect(tools.canRepeat()).toBe(false);
    await tools.generate();
    tools.action.set('style'); tools.prompt.set('changed');
    expect(tools.canRepeat()).toBe(true);
    await tools.repeat();
    expect(session.requests[1]).toEqual(session.requests[0]);
    expect(editor.document().layers).toHaveLength(3);
  });
});

describe('the prompt library (FEAT-0029, SC-0152)', () => {
  it('loads, saves, marks favourite and removes prompts through the session', async () => {
    const { session, tools } = setup([], []);
    session.stored = [{ id: 'x', title: 'Mine', prompt: 'p', action: 'style', creativity: 0.3, favorite: false }];
    await tools.loadPrompts();
    expect(tools.library()[0].id).toBe('x');
    tools.prompt.set('Glow'); tools.action.set('reinterpret'); tools.setCreativity(0.9);
    expect(await tools.savePrompt('Neon')).toBe(true);
    const neon = session.stored.find((prompt) => prompt.title === 'Neon')!;
    expect(neon).toMatchObject({ prompt: 'Glow', action: 'reinterpret', creativity: 0.9 });
    await tools.toggleFavourite(neon.id);
    expect(tools.library()[0]).toMatchObject({ id: neon.id, favorite: true });
    tools.usePrompt(tools.library().find((prompt) => prompt.id === 'x')!);
    expect([tools.prompt(), tools.action(), tools.creativity()]).toEqual(['p', 'style', 0.3]);
    await tools.removePrompt('x');
    expect(session.stored.map((prompt) => prompt.id)).toEqual([neon.id]);
  });

  it('keeps the list as it was when the server refuses to save', async () => {
    const { session, tools } = setup([], []);
    session.failSaving = true;
    tools.prompt.set('Glow');
    expect(await tools.savePrompt('Neon')).toBe(false);
    expect(tools.saved()).toEqual([]);
    expect(tools.outcome()).toEqual({ ok: false, text: 'The server is unreachable.' });
  });
});

describe('an empty document (FEAT-0029, SC-0150)', () => {
  it('says there is nothing to send and sends nothing', async () => {
    const { session, tools } = setup([], []);
    tools.scope.set('document'); tools.action.set('enhance');
    expect(await tools.generate()).toBe(false);
    expect(tools.outcome()).toEqual({ ok: false, text: 'The document has nothing visible to send.' });
    expect(session.requests).toEqual([]);
  });
});

describe('bitmap or vector result (FEAT-0029, SC-0157)', () => {
  it('sends the drawing as SVG and asks for a vector result when the user chooses one', async () => {
    const { session, tools } = setup([rect('a', 10, 10, 40, 20)], ['a']);
    session.answer = async () => ({ kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="shape"><rect width="10" height="10" fill="#f00"/></g></svg>' });
    tools.action.set('style'); tools.prompt.set('red'); tools.output.set('vector');
    expect(await tools.generate()).toBe(true);
    const [request] = session.requests;
    expect(request.output).toBe('vector');
    expect(request.selectionSvg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="42" height="22" viewBox="9 9 42 22">/);
    expect(request.selectionSvg).not.toContain('100%');
    expect(describeRequest(request).map((item) => item.label)).toContain('Drawing as SVG');
    expect(tools.outcome()?.text).toBe('The result was inserted as editable paths.');
  });

  it('sends no SVG for a bitmap result', async () => {
    const { session, tools } = setup([rect('a', 10, 10, 40, 20)], ['a']);
    tools.action.set('enhance');
    await tools.generate();
    expect([session.requests[0].output, session.requests[0].selectionSvg]).toEqual(['bitmap', undefined]);
  });

  it('traces pictures into a vector result, sending them as pixels only', async () => {
    const picture = { ...newLayer('image', 'p', { x: 0, y: 0 }), width: 10, height: 10, source: createCanvas(4, 4).toDataURL('image/png') };
    const { editor, session, tools } = setup([picture, rect('a', 20, 0, 10, 10)], ['p', 'a']);
    // The test canvas cannot paint a real picture; what matters here is what the request carries.
    vi.spyOn(editor, 'rasterizePng').mockResolvedValue({ source: 'data:image/png;base64,AAAA', frame: { x: 0, y: 0, width: 30, height: 10 } } as never);
    session.answer = async () => ({ kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="traced"><rect width="10" height="10" fill="#f00"/></g></svg>' });
    tools.action.set('vectorize');
    expect(tools.pictures()).toBe(true);
    expect(tools.problem()).toBe('');
    expect(await tools.generate()).toBe(true);
    const [request] = session.requests;
    expect([request.output, request.pictures]).toEqual(['vector', true]);
    expect(request.selectionSvg).not.toContain('<image');
    expect(request.selectionSvg).not.toContain('base64');
    expect(request.selectionPng).toMatch(/^data:image\/png/);
  });

  it('marks no pictures for a drawing of shapes only', async () => {
    const { session, tools } = setup([rect('a', 0, 0, 10, 10)], ['a']);
    tools.action.set('vectorize');
    await tools.generate();
    expect(session.requests[0].pictures).toBeUndefined();
  });

  it('remembers the result type with a saved prompt', async () => {
    const { session, tools } = setup([], []);
    tools.prompt.set('Recolour'); tools.output.set('vector');
    await tools.savePrompt('Palette');
    expect(session.stored[0].output).toBe('vector');
    tools.output.set('bitmap');
    tools.usePrompt(session.stored[0]);
    expect(tools.output()).toBe('vector');
  });
});

describe('which model works (FEAT-0029, SC-0154)', () => {
  it('lists the models tried while the request runs and keeps the one that made the result', async () => {
    const { session, tools } = setup([rect('a', 0, 0, 10, 10)], ['a']);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (session as any).generate = async (request: AgentRequest, _signal?: AbortSignal, onEvent?: (event: any) => void) => {
      session.requests.push(request);
      onEvent?.({ type: 'trying', model: 'gpt-image-2.5-flare' });
      onEvent?.({ type: 'trying', model: 'gpt-image-2' });
      await gate;
      return { kind: 'image', png: createCanvas(20, 10).toDataURL('image/png'), model: 'gpt-image-2' };
    };
    tools.action.set('enhance');
    const running = tools.generate();
    await vi.waitFor(() => expect(tools.tried()).toEqual(['gpt-image-2.5-flare', 'gpt-image-2']));
    release();
    expect(await running).toBe(true);
    expect(tools.usedModel()).toBe('gpt-image-2');
  });

  it('describes the model being tried and the one it left', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    expect(template).toContain('agentModelNote()');
    expect(template).toContain('Made with {model}');
    const source = readFileSync('apps/web/src/app/app.component.ts', 'utf-8');
    expect(source).toContain('Trying the best model to do this: {model}');
    expect(source).toContain('{previous} is not available; trying {model}');
  });
});
