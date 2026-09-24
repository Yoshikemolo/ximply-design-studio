/**
 * The agent tools' requests and prompt library (FEAT-0029): what the panel sends, the quick
 * actions it offers, and the prompts a user keeps. Prompt texts are sent to the model and are
 * English; titles are shown in the panel and come from the EN/ES catalogs.
 */
export type AgentAction = "free" | "style" | "reinterpret" | "upscale" | "enhance" | "remove-watermark" | "remove-background" | "remove-object" | "vectorize";
export type AgentScope = "selection" | "document";
/** Pixels from the image model, or an editable drawing of paths and groups (SC-0157). */
export type AgentOutput = "bitmap" | "vector";

export interface AgentRequest {
  prompt: string;
  action: AgentAction;
  scope: AgentScope;
  creativity: number;
  selectionPng?: string;
  documentPng?: string;
  selectionData?: string;
  output?: AgentOutput;
  selectionSvg?: string;
}
export type AgentResult = { kind: "image"; png: string } | { kind: "svg"; svg: string };

export interface SavedPrompt { id: string; title: string; prompt: string; action: AgentAction; creativity: number; favorite: boolean; output?: AgentOutput; hidden?: boolean }
export interface LibraryPrompt extends SavedPrompt { builtIn: boolean }

/** The quick actions in panel order, and whether each needs the user to say what to do. */
export const AGENT_ACTIONS: readonly { action: AgentAction; title: string; needsPrompt: boolean }[] = [
  { action: "style", title: "Change style", needsPrompt: true },
  { action: "reinterpret", title: "Reinterpret in a style", needsPrompt: true },
  { action: "upscale", title: "Rescale", needsPrompt: false },
  { action: "enhance", title: "Improve quality", needsPrompt: false },
  { action: "remove-watermark", title: "Remove watermarks", needsPrompt: false },
  { action: "remove-background", title: "Clean the background", needsPrompt: false },
  { action: "remove-object", title: "Remove an object", needsPrompt: true },
  { action: "vectorize", title: "Convert to paths and groups", needsPrompt: false },
];

export const MAX_SAVED_PROMPTS = 200;

/** The prompts every user starts with; they can be marked favourite or hidden, not changed. */
export const DEFAULT_PROMPTS: readonly SavedPrompt[] = [
  { id: "default-watercolour", title: "Watercolour", prompt: "Paint it as a soft watercolour on white paper, with visible brush edges.", action: "style", creativity: 0.6, favorite: false },
  { id: "default-flat", title: "Flat illustration", prompt: "Redraw it as a flat vector illustration with a limited palette and no gradients.", action: "reinterpret", creativity: 0.7, favorite: false },
  { id: "default-line-art", title: "Line art", prompt: "Turn it into clean black line art on a transparent background.", action: "style", creativity: 0.4, favorite: false },
  { id: "default-photo", title: "Photographic", prompt: "Make it look like a realistic studio photograph with soft lighting.", action: "reinterpret", creativity: 0.6, favorite: false },
  { id: "default-sharpen", title: "Sharpen and denoise", prompt: "", action: "enhance", creativity: 0.1, favorite: false },
  { id: "default-cutout", title: "Cut out the subject", prompt: "", action: "remove-background", creativity: 0.1, favorite: false },
  { id: "default-logo", title: "Logo to paths", prompt: "Keep the shapes of the logo and its colours exactly.", action: "vectorize", creativity: 0.2, favorite: false, output: "vector" },
  { id: "default-recolour", title: "Recolour the drawing", prompt: "Recolour the drawing with a harmonious palette of four colours, keeping every shape.", action: "style", creativity: 0.5, favorite: false, output: "vector" },
];

export function isBuiltIn(id: string): boolean { return DEFAULT_PROMPTS.some((prompt) => prompt.id === id); }

/**
 * The list the panel shows: favourites first, then the user's prompts, then the defaults, each
 * group in its own order. A saved entry with a default's id only records that the default is a
 * favourite, or that the user removed it from the list.
 */
export function promptLibrary(saved: readonly SavedPrompt[]): LibraryPrompt[] {
  const favourites = new Set(saved.filter((prompt) => prompt.favorite).map((prompt) => prompt.id));
  const hidden = new Set(saved.filter((prompt) => prompt.hidden).map((prompt) => prompt.id));
  const own = saved.filter((prompt) => !isBuiltIn(prompt.id)).map((prompt) => ({ ...prompt, builtIn: false }));
  const defaults = DEFAULT_PROMPTS.filter((prompt) => !hidden.has(prompt.id)).map((prompt) => ({ ...prompt, favorite: favourites.has(prompt.id), builtIn: true }));
  const all = [...own, ...defaults];
  return [...all.filter((prompt) => prompt.favorite), ...all.filter((prompt) => !prompt.favorite)];
}

/** Saves a prompt under its title: a prompt with the same title is replaced, keeping its id and favourite mark. */
export function savePrompt(saved: readonly SavedPrompt[], entry: Omit<SavedPrompt, "id" | "favorite">, makeId: () => string): SavedPrompt[] {
  const title = entry.title.trim().slice(0, 80);
  if (!title) throw new Error("Give the prompt a title.");
  const existing = saved.find((prompt) => !isBuiltIn(prompt.id) && prompt.title.toLowerCase() === title.toLowerCase());
  const prompt: SavedPrompt = { ...entry, title, prompt: entry.prompt.slice(0, 4000), id: existing?.id ?? makeId(), favorite: existing?.favorite ?? false,
    creativity: Math.min(1, Math.max(0, entry.creativity)) };
  if (existing) return saved.map((item) => (item.id === existing.id ? prompt : item));
  if (saved.filter((item) => !isBuiltIn(item.id)).length >= MAX_SAVED_PROMPTS) throw new Error("Remove a saved prompt before saving another.");
  return [...saved, prompt];
}

/** Marks or unmarks a prompt as favourite; for a default, the mark is kept as a small entry. */
export function toggleFavourite(saved: readonly SavedPrompt[], id: string): SavedPrompt[] {
  const found = saved.find((prompt) => prompt.id === id);
  if (found) {
    if (isBuiltIn(id) && found.favorite) return saved.filter((prompt) => prompt.id !== id);
    return saved.map((prompt) => (prompt.id === id ? { ...prompt, favorite: !prompt.favorite } : prompt));
  }
  const builtIn = DEFAULT_PROMPTS.find((prompt) => prompt.id === id);
  return builtIn ? [...saved, { ...builtIn, favorite: true }] : [...saved];
}

/** Removes a saved prompt; a default is only hidden from this user's list. */
export function removePrompt(saved: readonly SavedPrompt[], id: string): SavedPrompt[] {
  const builtIn = DEFAULT_PROMPTS.find((prompt) => prompt.id === id);
  if (!builtIn) return saved.filter((prompt) => prompt.id !== id);
  return [...saved.filter((prompt) => prompt.id !== id), { ...builtIn, favorite: false, hidden: true }];
}

/** Whether the user hid any default, and the list with every default shown again. */
export function hiddenDefaults(saved: readonly SavedPrompt[]): number { return saved.filter((prompt) => prompt.hidden && isBuiltIn(prompt.id)).length; }
export function restoreDefaults(saved: readonly SavedPrompt[]): SavedPrompt[] { return saved.filter((prompt) => !(prompt.hidden && isBuiltIn(prompt.id))); }

/** Lower case without accents, so that searching "acuarela" or "ACUARELA" finds the same prompts. */
function plain(text: string): string { return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

/**
 * The prompts whose title, text or action contain every word of the query; `label` gives the
 * text shown for a title or an action, so a translated list is searched as the user reads it.
 */
export function filterPrompts<T extends SavedPrompt>(prompts: readonly T[], query: string, label: (text: string) => string = (text) => text): T[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...prompts];
  return prompts.filter((prompt) => {
    const title = AGENT_ACTIONS.find((item) => item.action === prompt.action)?.title ?? "";
    const haystack = plain([prompt.title, label(prompt.title), prompt.prompt, title, label(title)].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}

/** The result a request asks for: Convert to paths and groups always draws vectors. */
export function effectiveOutput(action: AgentAction, output: AgentOutput): AgentOutput {
  return action === "vectorize" ? "vector" : output;
}

/** Why a request cannot be sent yet, or an empty string when it can. */
export function requestProblem(action: AgentAction, prompt: string, scope: AgentScope, selected: number, output: AgentOutput = "bitmap", pictures = false): string {
  if (pictures && effectiveOutput(action, output) === "vector") return "Vector results are not available when the context holds pictures.";
  const needsPrompt = action === "free" || AGENT_ACTIONS.some((item) => item.action === action && item.needsPrompt);
  if (needsPrompt && !prompt.trim()) return "Write what the model should do.";
  if (scope === "selection" && selected === 0) return "Select objects, or choose the whole document as the context.";
  return "";
}
