import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS, MAX_SAVED_PROMPTS, promptLibrary, removePrompt, requestProblem, savePrompt, toggleFavourite, type SavedPrompt } from '../src/agent-prompts';

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
    expect(removePrompt(marked, 'default-flat')).toEqual(marked);
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

  it('asks for a selection when the selection is the context', () => {
    expect(requestProblem('enhance', '', 'selection', 0)).toBe('Select objects, or choose the whole document as the context.');
  });
});
