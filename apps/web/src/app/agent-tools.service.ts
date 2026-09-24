import { Injectable, computed, signal } from "@angular/core";
import { EditorService } from "./editor.service";
import { SessionService } from "./session.service";
import { Frame, pngSize } from "../../../../packages/domain/src/agent-result";
import {
  AGENT_ACTIONS, AgentAction, AgentRequest, AgentScope, LibraryPrompt, SavedPrompt,
  promptLibrary, removePrompt, requestProblem, savePrompt, toggleFavourite,
} from "../../../../packages/domain/src/agent-prompts";

/** A step of a request as the panel shows it while the request is on its way. */
export type AgentPhase = "idle" | "capturing" | "sending" | "waiting" | "inserting";
export interface ContextItem { id: "prompt" | "data" | "selection" | "document" | "modifiers"; label: string; detail: string }

/**
 * The agent tools panel's facade (FEAT-0029): the choices of the panel, the prompt library, and
 * the request cycle — capture the context, send it through the API, and insert the result as a
 * new object. The provider token never reaches the browser; the API holds it.
 */
@Injectable({ providedIn: "root" })
export class AgentToolsService {
  readonly scope = signal<AgentScope>("selection");
  readonly action = signal<AgentAction>("free");
  readonly prompt = signal("");
  readonly creativity = signal(0.5);
  readonly phase = signal<AgentPhase>("idle");
  /** What the last request carried, labelled, so the user sees what was sent. */
  readonly sent = signal<ContextItem[]>([]);
  readonly outcome = signal<{ ok: boolean; text: string } | null>(null);
  readonly saved = signal<SavedPrompt[]>([]);
  readonly library = computed<LibraryPrompt[]>(() => promptLibrary(this.saved()));
  readonly busy = computed(() => this.phase() !== "idle");
  readonly canRepeat = computed(() => this.lastRun() > 0 && !this.busy() && !!this.last);
  readonly actions = AGENT_ACTIONS;
  private readonly lastRun = signal(0);
  private last?: { request: AgentRequest; frame: Frame; name: string };
  private controller?: AbortController;
  private loaded = false;

  constructor(private readonly editor: EditorService, private readonly session: SessionService) {}

  /** Why Generate is not available yet, or an empty string. */
  readonly problem = computed(() => requestProblem(this.action(), this.prompt(), this.scope(), this.editor.selectedLayers().filter((layer) => !layer.guide).length));

  chooseAction(action: AgentAction) { this.action.set(this.action() === action ? "free" : action); }
  setCreativity(value: number) { if (Number.isFinite(value)) this.creativity.set(Math.min(1, Math.max(0, value))); }

  /** Loads the user's saved prompts once per session; the defaults are always there. */
  async loadPrompts(force = false) {
    if (this.loaded && !force) return;
    try {
      this.saved.set(await this.session.savedPrompts());
      this.loaded = true;
    } catch (error) {
      this.outcome.set({ ok: false, text: (error as Error).message });
    }
  }
  usePrompt(prompt: SavedPrompt) {
    this.prompt.set(prompt.prompt);
    this.action.set(prompt.action);
    this.creativity.set(prompt.creativity);
  }
  async savePrompt(title: string): Promise<boolean> {
    try {
      return await this.storePrompts(savePrompt(this.saved(), { title, prompt: this.prompt(), action: this.action(), creativity: this.creativity() }, () => crypto.randomUUID()), "The prompt was saved.");
    } catch (error) {
      this.outcome.set({ ok: false, text: (error as Error).message });
      return false;
    }
  }
  toggleFavourite(id: string) { return this.storePrompts(toggleFavourite(this.saved(), id), ""); }
  removePrompt(id: string) { return this.storePrompts(removePrompt(this.saved(), id), "The prompt was removed."); }
  private async storePrompts(prompts: SavedPrompt[], done: string): Promise<boolean> {
    const before = this.saved();
    this.saved.set(prompts);
    try {
      this.saved.set(await this.session.savePrompts(prompts));
      if (done) this.outcome.set({ ok: true, text: done });
      return true;
    } catch (error) {
      this.saved.set(before);
      this.outcome.set({ ok: false, text: (error as Error).message });
      return false;
    }
  }

  /** Captures the context, sends the request and inserts what comes back as a new object. */
  async generate(): Promise<boolean> {
    if (this.busy()) return false;
    const problem = this.problem();
    if (problem) { this.outcome.set({ ok: false, text: problem }); return false; }
    this.outcome.set(null);
    this.phase.set("capturing");
    const context = await this.editor.agentContext(this.scope());
    if (!context) { this.phase.set("idle"); this.outcome.set({ ok: false, text: this.editor.status() || "The context could not be captured." }); return false; }
    const request: AgentRequest = { prompt: this.prompt().trim(), action: this.action(), scope: this.scope(), creativity: this.creativity(), ...context };
    delete (request as Partial<typeof context>).frame;
    delete (request as Partial<typeof context>).count;
    const title = this.actions.find((item) => item.action === request.action)?.title ?? "Generated";
    const name = request.prompt ? `${title}: ${request.prompt.slice(0, 60)}` : title;
    return this.send(request, context.frame, name);
  }

  /** Sends the last request again, with the same context and choices, for another variant. */
  repeat(): Promise<boolean> {
    if (!this.last || this.busy()) return Promise.resolve(false);
    return this.send(this.last.request, this.last.frame, this.last.name);
  }

  cancel() { this.controller?.abort(); }

  private async send(request: AgentRequest, frame: Frame, name: string): Promise<boolean> {
    this.sent.set(describe(request));
    this.phase.set("sending");
    this.controller = new AbortController();
    const waiting = setTimeout(() => { if (this.phase() === "sending") this.phase.set("waiting"); }, 600);
    try {
      const result = await this.session.generate(request, this.controller.signal);
      this.phase.set("inserting");
      this.last = { request, frame, name };
      this.lastRun.update((count) => count + 1);
      const inserted = result.kind === "svg"
        ? this.editor.insertAgentDrawing(result.svg, frame, name)
        : this.insertPicture(result.png, frame, name);
      this.outcome.set({ ok: inserted, text: this.editor.status() });
      return inserted;
    } catch (error) {
      const aborted = this.controller.signal.aborted;
      this.outcome.set({ ok: false, text: aborted ? "The request was cancelled." : (error as Error).message });
      return false;
    } finally {
      clearTimeout(waiting);
      this.controller = undefined;
      this.phase.set("idle");
    }
  }
  private insertPicture(png: string, frame: Frame, name: string): boolean {
    const size = pngSize(png);
    if (!size) { this.editor.status.set("The picture the model returned cannot be read."); return false; }
    return this.editor.insertAgentPicture(png, size.width, size.height, frame, name);
  }
}

/** The labelled parts of a request, in the order the panel lists them. */
export function describe(request: AgentRequest): ContextItem[] {
  const items: ContextItem[] = [];
  if (request.prompt) items.push({ id: "prompt", label: "Prompt", detail: `${request.prompt.length} characters` });
  if (request.selectionData) items.push({ id: "data", label: "Selected objects as data", detail: kilobytes(request.selectionData.length) });
  if (request.selectionPng) items.push({ id: "selection", label: "Selection as PNG", detail: kilobytes(request.selectionPng.length * 0.75) });
  if (request.documentPng) items.push({ id: "document", label: "Whole document as PNG", detail: kilobytes(request.documentPng.length * 0.75) });
  items.push({ id: "modifiers", label: "Modifiers", detail: `${request.action}, ${Math.round(request.creativity * 100)}%` });
  return items;
}
function kilobytes(bytes: number): string { return `${Math.max(1, Math.round(bytes / 1024))} KB`; }
