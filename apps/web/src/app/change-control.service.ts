import { Injectable, computed, signal } from "@angular/core";
import { EditorService } from "./editor.service";
import { SessionService } from "./session.service";
import { GraphRow, layoutGraph } from "../../../../packages/domain/src/commit-graph";
import { parseDocument } from "../../../../packages/domain/src/document";

export interface VcsProject { id: string; name: string; createdBy: string; createdAt: string }
export interface VcsStatus {
  branch: string | null; head: string; upstream: string | null; ahead: number; behind: number;
  merging: boolean; conflicts: string[]; changes: string[]; canUndo: boolean; canRedo: boolean;
}
export interface VcsCommit { sha: string; parents: string[]; author: string; email: string; date: string; subject: string }
export interface VcsRef { name: string; sha: string; kind: "local" | "remote" }
export interface VcsLog { commits: VcsCommit[]; refs: VcsRef[]; truncated: boolean; comments: Record<string, number> }
export interface VcsDetails { sha: string; parents: string[]; author: string; email: string; date: string; message: string; files: { status: string; path: string }[] }
export interface VcsComment { id: string; subject: string; author: string; text: string; createdAt: string }
interface Answer<T = unknown> { result: T; status: VcsStatus; moved: boolean }

/** One row of the History tab: the commit, its place in the graph and the branches on it. */
export interface HistoryRow extends GraphRow { commit: VcsCommit; refs: VcsRef[]; head: boolean; comments: number }

/** Keys in a stable order, so two equal documents give the same text whatever order built them. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, (item as Record<string, unknown>)[key]]))
    : item));
}

/**
 * The History tab's facade (FEAT-0031): one project repository linked to one editor tab, its
 * status and graph, and the operations of the API. Operations that move HEAD reload the
 * document into the linked tab as one undo step of the editor.
 */
@Injectable({ providedIn: "root" })
export class ChangeControlService {
  readonly projects = signal<VcsProject[]>([]);
  readonly project = signal<VcsProject | null>(null);
  readonly status = signal<VcsStatus | null>(null);
  readonly log = signal<VcsLog | null>(null);
  readonly selected = signal<string | null>(null);
  readonly details = signal<VcsDetails | null>(null);
  readonly comments = signal<VcsComment[]>([]);
  readonly thumbnails = signal<Record<string, string | null>>({});
  readonly busy = signal<string>("");
  readonly outcome = signal<{ ok: boolean; text: string } | null>(null);
  /** The editor tab that holds the project's document, and that document as last loaded or committed. */
  readonly linkedTab = signal<string | null>(null);
  private readonly baseline = signal("");

  constructor(private readonly editor: EditorService, private readonly session: SessionService) {}

  /** Whether the linked document differs from the commit it was loaded from or saved as. */
  readonly dirty = computed(() => {
    const tab = this.linkedTab();
    if (!tab || !this.project()) return false;
    if (tab !== this.editor.activeTabId()) return this.editor.isDocumentDirty(tab);
    return stableJson(this.editor.document()) !== this.baseline();
  });

  readonly rows = computed<HistoryRow[]>(() => {
    const log = this.log();
    if (!log) return [];
    const graph = layoutGraph(log.commits);
    const head = this.status()?.head;
    return graph.rows.map((row, index) => ({
      ...row, commit: log.commits[index], head: log.commits[index].sha === head,
      refs: log.refs.filter((ref) => ref.sha === log.commits[index].sha), comments: log.comments[log.commits[index].sha] ?? 0,
    }));
  });
  readonly lanes = computed(() => Math.max(1, ...this.rows().map((row) => Math.max(row.lane, ...row.passes, ...row.incoming, ...row.outgoing) + 1)));
  readonly localBranches = computed(() => (this.log()?.refs ?? []).filter((ref) => ref.kind === "local").map((ref) => ref.name));
  readonly otherBranches = computed(() => {
    const current = this.status()?.branch;
    return (this.log()?.refs ?? []).map((ref) => ref.name).filter((name) => name !== current && name !== `origin/${current}`);
  });

  private base(): string {
    const project = this.project();
    if (!project) throw new Error("Open a project first.");
    return `/projects/${project.id}`;
  }

  async loadProjects() {
    await this.guard("projects", async () => { this.projects.set((await this.session.vcs<{ projects: VcsProject[] }>("/projects")).projects); });
  }

  /** Makes a project of the active document: a repository with a first commit. */
  async createProject(name: string): Promise<boolean> {
    return this.guard("create", async () => {
      const thumbnail = await this.editor.documentThumbnail();
      const project = await this.session.vcs<VcsProject>("/projects", "POST", { name: name.trim(), document: this.editor.document(), thumbnail });
      this.project.set(project);
      this.linkedTab.set(this.editor.activeTabId());
      this.baseline.set(stableJson(this.editor.document()));
      this.editor.markSaved();
      await this.refresh();
      this.projects.update((list) => [project, ...list.filter((item) => item.id !== project.id)]);
      this.outcome.set({ ok: true, text: "The project was created with its first commit." });
    });
  }

  /** Opens a project: its document goes into a tab, which stays linked to the repository. */
  async openProject(project: VcsProject): Promise<boolean> {
    return this.guard("open", async () => {
      this.project.set(project);
      const { document } = await this.session.vcs<{ document: unknown }>(`/projects/${project.id}/document`);
      this.editor.openDocument(JSON.stringify(document));
      this.linkedTab.set(this.editor.activeTabId());
      this.baseline.set(stableJson(this.editor.document()));
      this.selected.set(null);
      this.details.set(null);
      await this.refresh();
    });
  }

  close() {
    this.project.set(null); this.status.set(null); this.log.set(null); this.linkedTab.set(null);
    this.selected.set(null); this.details.set(null); this.comments.set([]); this.thumbnails.set({});
  }

  async refresh() {
    const base = this.base();
    const [status, log] = await Promise.all([this.session.vcs<VcsStatus>(base + "/status"), this.session.vcs<VcsLog>(base + "/log")]);
    this.status.set(status);
    this.log.set(log);
  }

  async select(sha: string | null) {
    this.selected.set(sha);
    this.details.set(null);
    this.comments.set([]);
    if (!sha) return;
    await this.guard("", async () => {
      const [details, comments] = await Promise.all([
        this.session.vcs<VcsDetails>(`${this.base()}/commits/${sha}`),
        this.session.vcs<{ comments: VcsComment[] }>(`${this.base()}/commits/${sha}/comments`),
      ]);
      if (this.selected() !== sha) return;
      this.details.set(details);
      this.comments.set(comments.comments);
    });
  }

  /** The thumbnail a commit keeps, fetched once when the pointer first rests on its node. */
  async thumbnail(sha: string) {
    if (sha in this.thumbnails() || !this.project()) return;
    this.thumbnails.update((cache) => ({ ...cache, [sha]: null }));
    try {
      const { png } = await this.session.vcs<{ png: string | null }>(`${this.base()}/commits/${sha}/thumbnail`);
      this.thumbnails.update((cache) => ({ ...cache, [sha]: png }));
    } catch {
      // Without a thumbnail the node shows its message only.
    }
  }

  async addComment(text: string): Promise<boolean> {
    const sha = this.selected();
    if (!sha || !text.trim()) return false;
    return this.guard("comment", async () => {
      const added = await this.session.vcs<VcsComment>(`${this.base()}/commits/${sha}/comments`, "POST", { text: text.trim() });
      this.comments.update((list) => [...list, added]);
      this.log.update((log) => log && { ...log, comments: { ...log.comments, [sha]: (log.comments[sha] ?? 0) + 1 } });
    });
  }
  async removeComment(id: string): Promise<boolean> {
    const sha = this.selected();
    if (!sha) return false;
    return this.guard("comment", async () => {
      await this.session.vcs(`${this.base()}/commits/${sha}/comments/${id}`, "DELETE");
      this.comments.update((list) => list.filter((comment) => comment.id !== id));
      this.log.update((log) => log && { ...log, comments: { ...log.comments, [sha]: Math.max(0, (log.comments[sha] ?? 1) - 1) } });
    });
  }

  /** Commits the linked document, with a thumbnail of it. */
  async commit(message: string): Promise<boolean> {
    if (!message.trim()) { this.outcome.set({ ok: false, text: "Write a message for the commit." }); return false; }
    return this.guard("commit", async () => {
      this.showLinkedTab();
      const document = this.editor.document();
      const thumbnail = await this.editor.documentThumbnail();
      await this.apply(await this.session.vcs<Answer>(`${this.base()}/commit`, "POST", { message: message.trim(), document, thumbnail }), false);
      this.baseline.set(stableJson(document));
      this.editor.markSaved();
      this.outcome.set({ ok: true, text: "Committed." });
    });
  }

  newBranch(name: string, at?: string) { return this.operate("branch", "/branches", "POST", { name: name.trim(), ...(at ? { at } : {}) }, "The branch was created."); }
  renameBranch(from: string, to: string) { return this.operate("rename", `/branches/${from}`, "PATCH", { name: to.trim() }, "The branch was renamed."); }
  deleteBranch(name: string, force = false) { return this.operate("delete", `/branches/${name}${force ? "?force=true" : ""}`, "DELETE", undefined, "The branch was deleted."); }
  checkout(ref: string) { return this.operate("checkout", "/checkout", "POST", { ref }, "Checked out."); }
  merge(ref: string) { return this.operate("merge", "/merge", "POST", { ref }, "Merged."); }
  abortMerge() { return this.operate("abort", "/merge/abort", "POST", undefined, "The merge was aborted."); }
  resolve(path: string, side: "mine" | "theirs") { return this.operate("resolve", "/merge/resolve", "POST", { path, side }, "The conflict was resolved."); }
  fetch() { return this.operate("fetch", "/fetch", "POST", undefined, "Fetched from the shared repository."); }
  pull() { return this.operate("pull", "/pull", "POST", undefined, "Pulled from the shared repository."); }
  push() { return this.operate("push", "/push", "POST", undefined, "Pushed to the shared repository."); }
  revert(sha: string) { return this.operate("revert", "/revert", "POST", { ref: sha }, "The commit was reverted."); }
  undo() { return this.operate("undo", "/undo", "POST", undefined, "Undone."); }
  redo() { return this.operate("redo", "/redo", "POST", undefined, "Redone."); }

  /** Whether an operation would replace the document in the editor, so unsaved work needs a decision first. */
  replacesDocument(operation: "checkout" | "merge" | "pull" | "undo" | "redo" | "revert" | "resolve"): boolean {
    return this.dirty() && operation !== "resolve";
  }

  async copySha(sha: string) {
    try { await navigator.clipboard.writeText(sha); this.outcome.set({ ok: true, text: "The commit identifier was copied." }); }
    catch { this.outcome.set({ ok: false, text: "The clipboard is not available." }); }
  }

  private operate(name: string, path: string, method: "POST" | "PATCH" | "DELETE", body: unknown, done: string): Promise<boolean> {
    return this.guard(name, async () => {
      const answer = await this.session.vcs<Answer<{ conflicts?: string[]; finished?: boolean; operation?: string }>>(this.base() + path, method, body);
      // Undoing or redoing a commit keeps the document in the editor, as a commit undone to its parent keeps its changes.
      const keep = (name === "undo" || name === "redo") && answer.result?.operation === "commit";
      await this.apply(answer, !keep);
      const conflicts = answer.result?.conflicts ?? [];
      this.outcome.set(conflicts.length ? { ok: false, text: "The merge has conflicts: choose a side for each file, or abort it." } : { ok: true, text: done });
    });
  }

  private async apply(answer: Answer, reload: boolean) {
    this.status.set(answer.status);
    this.log.set(await this.session.vcs<VcsLog>(this.base() + "/log"));
    if (answer.moved && !answer.status.conflicts.length) {
      const { document } = await this.session.vcs<{ document: unknown }>(this.base() + "/document");
      const text = JSON.stringify(document);
      if (reload) {
        this.showLinkedTab();
        this.editor.open(text);
        this.baseline.set(stableJson(this.editor.document()));
      } else {
        this.baseline.set(stableJson(parseDocument(text)));
      }
    }
  }

  private showLinkedTab() {
    const tab = this.linkedTab();
    if (tab && tab !== this.editor.activeTabId() && this.editor.tabs().some((item) => item.id === tab)) this.editor.switchDocument(tab);
    if (!tab || !this.editor.tabs().some((item) => item.id === tab)) this.linkedTab.set(this.editor.activeTabId());
  }

  private async guard(name: string, work: () => Promise<void>): Promise<boolean> {
    if (name && this.busy()) return false;
    if (name) this.busy.set(name);
    try {
      await work();
      return true;
    } catch (error) {
      this.outcome.set({ ok: false, text: (error as Error).message });
      return false;
    } finally {
      if (name) this.busy.set("");
    }
  }
}
