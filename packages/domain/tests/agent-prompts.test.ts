import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS, MAX_SAVED_PROMPTS, effectiveOutput, filterPrompts, hiddenDefaults, promptLibrary, removePrompt, requestProblem, restoreDefaults, savePrompt, toggleFavourite, type SavedPrompt } from '../src/agent-prompts';

let counter = 0;
const makeId = () => `p${++counter}`;
const mine: SavedPrompt = { id: 'mine', title: 'Neon', prompt: 'Neon glow', action: 'style', creativity: 0.8, favorite: false };

describe('prompt library (FEAT-0029, SC-0152)', () => {
  it('offers the defaults to a user with no saved prompts', () => {
    const library = promptLibrary([]);
    expect(library.map((prompt) => prompt.id)).toEqual(DEFAULT_PROMPTS.map((prompt) => prompt.id));
    expect(library.every((prompt) => prompt.builtIn && !prompt.favorite)).toBe(true);
  });

  it('lists favourites first, then own prompts, then defaults', () => {
    const saved = toggleFavourite([mine, { ...mine, id: 'fav', title: 'Fav', favorite: true }], 'default-line-art');
    expect(promptLibrary(saved).map((prompt) => prompt.id).slice(0, 4)).toEqual(['fav', 'default-line-art', 'mine', 'default-watercolour']);
  });

  it('marks and unmarks a default as favourite without copying it twice or changing it', () => {
    const marked = toggleFavourite([], 'default-flat');
    expect(marked).toHaveLength(1);
    expect(promptLibrary(marked).filter((prompt) => prompt.id === 'default-flat')).toHaveLength(1);
    expect(toggleFavourite(marked, 'default-flat')).toEqual([]);
  });

  it('hides a removed default until the defaults are restored', () => {
    const hidden = removePrompt(toggleFavourite([], 'default-flat'), 'default-flat');
    expect(promptLibrary(hidden).some((prompt) => prompt.id === 'default-flat')).toBe(false);
    expect(hiddenDefaults(hidden)).toBe(1);
    expect(restoreDefaults(hidden)).toEqual([]);
    expect(promptLibrary(restoreDefaults(hidden)).filter((prompt) => prompt.id === 'default-flat')).toHaveLength(1);
  });

  it('filters by every word of the query in the title, text or action, ignoring case and accents', () => {
    const library = promptLibrary([mine, { ...mine, id: 'es', title: 'Acuarela suave', prompt: 'Pintura' }]);
    expect(filterPrompts(library, '').length).toBe(library.length);
    expect(filterPrompts(library, 'NEON').map((prompt) => prompt.id)).toEqual(['mine']);
    expect(filterPrompts(library, 'acuarela suave').map((prompt) => prompt.id)).toEqual(['es']);
    expect(filterPrompts(library, 'glow acuarela')).toEqual([]);
    expect(filterPrompts(library, 'paths').map((prompt) => prompt.id)).toEqual(['default-logo']);
    const spanish = (text: string) => (text === 'Watercolour' ? 'Acuarela' : text);
    expect(filterPrompts(library, 'acuarela', spanish).map((prompt) => prompt.id)).toEqual(['es', 'default-watercolour']);
    expect(filterPrompts([{ ...mine, title: 'Crème brûlée' }], 'creme brulee')).toHaveLength(1);
  });

  it('saves under a title, replacing a prompt with the same title and keeping its mark', () => {
    const favourite = toggleFavourite([mine], 'mine');
    const saved = savePrompt(favourite, { title: ' neon ', prompt: 'Brighter', action: 'reinterpret', creativity: 3 }, makeId);
    expect(saved).toEqual([{ id: 'mine', title: 'neon', prompt: 'Brighter', action: 'reinterpret', creativity: 1, favorite: true }]);
    expect(savePrompt(saved, { title: 'Other', prompt: '', action: 'enhance', creativity: 0.2 }, makeId)).toHaveLength(2);
    expect(() => savePrompt(saved, { title: '  ', prompt: 'x', action: 'style', creativity: 0.5 }, makeId)).toThrow('Give the prompt a title.');
  });

  it('refuses to save beyond the limit the API accepts', () => {
    const full = Array.from({ length: MAX_SAVED_PROMPTS }, (_, index) => ({ ...mine, id: `m${index}`, title: `T${index}` }));
    expect(() => savePrompt(full, { title: 'One more', prompt: '', action: 'enhance', creativity: 0.5 }, makeId)).toThrow();
  });

  it('removes a saved prompt', () => {
    expect(removePrompt([mine], 'mine')).toEqual([]);
  });
});

describe('when a request can be sent (FEAT-0029, SC-0150)', () => {
  it('asks for a prompt only for the actions that need one', () => {
    expect(requestProblem('style', ' ', 'document', 0)).toBe('Write what the model should do.');
    expect(requestProblem('free', '', 'document', 0)).toBe('Write what the model should do.');
    expect(requestProblem('remove-object', 'the lamp', 'selection', 1)).toBe('');
    expect(requestProblem('enhance', '', 'document', 0)).toBe('');
  });

  it('always gives a vector result for Convert to paths and groups', () => {
    expect(effectiveOutput('vectorize', 'bitmap')).toBe('vector');
    expect(effectiveOutput('style', 'bitmap')).toBe('bitmap');
    expect(requestProblem('vectorize', '', 'selection', 1)).toBe('');
  });

  it('asks for a selection when the selection is the context', () => {
    expect(requestProblem('enhance', '', 'selection', 0)).toBe('Select objects, or choose the whole document as the context.');
  });
});
