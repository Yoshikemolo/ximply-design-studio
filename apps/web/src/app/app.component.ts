import { measurementUnits, isUnit, snapPoint, fromPixels, toPixels, formatMeasurement, rulerTicks as makeRulerTicks, SnapConfig } from "../../../../packages/domain/src/measurements";
import { PreferencesService } from "./preferences.service";
import {
  COMMANDS,
  eventChord,
  matchShortcut,
} from "../../../../packages/domain/src/shortcuts";
import {
  canvasWheelZoom,
  isCanvasZoomGesture,
} from "../../../../packages/domain/src/input";
import { ShapeOptions } from "../../../../packages/domain/src/shapes";
import { TraceOptions } from "../../../../packages/domain/src/tracing";
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  effect,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { EditorService, ContextAction, ContextTarget } from "./editor.service";
import { ContextMenuComponent, ContextMenuEntry } from "./context-menu.component";
import { TOOLS, ToolId, TOOL_FAMILIES, ToolFamily } from "./tools";
import { translate } from "./i18n";
import { BLENDS, Layer } from "../../../../packages/domain/src/document";
import { createSampleDocument } from "../../../../packages/domain/src/sample";
interface Release {
  version: string;
  date: string;
  summary: string;
  markdown: string;
  breakingChanges: string[];
}
@Component({
  selector: "xds-root",
  standalone: true,
  imports: [FormsModule, ContextMenuComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild("canvas") canvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild("viewport") viewport?: ElementRef<HTMLDivElement>;
  @ViewChild("spatialHost") spatialHost?: ElementRef<HTMLDivElement>;
  @ViewChild("imageFile") imageFile?: ElementRef<HTMLInputElement>;
  @ViewChild("projectFile") projectFile?: ElementRef<HTMLInputElement>;
  readonly contextMenu = signal<{ target: ContextTarget; x: number; y: number } | null>(null);
  readonly units = measurementUnits;
  readonly fontUnits = measurementUnits;
  readonly paintTargets = ["fill", "stroke"] as const;
  readonly quickColors = [{ value: "#000000", label: "Black" }, { value: "#ffffff", label: "White" }, { value: "none", label: "No color" }];
  readonly paintTarget = signal<"fill" | "stroke">("fill");
  readonly paintPicker = signal<{ x: number; y: number } | null>(null);
  readonly contextBlocks = [{ id: "appearance", label: "Appearance" }, { id: "workspace", label: "Workspace" }, { id: "measurement", label: "Measurement" }] as const;
  readonly measurementAids = [{ id: "rulers", label: "Rulers" }, { id: "guides", label: "Guides" }, { id: "grid", label: "Grid" }] as const;
  readonly draggingGuideId = signal<string | null>(null);
  private guideDrag?: { axis: "vertical" | "horizontal"; pointerId: number; element: HTMLElement };
  readonly families = TOOL_FAMILIES;
  readonly toolbarSections = [
    {
      id: "selection",
      label: "Selection tools",
      families: ["selection", "direct"],
    },
    {
      id: "drawing",
      label: "Drawing and paths",
      families: ["pen", "pencil", "shape", "line", "text", "scissors"],
    },
    {
      id: "paint",
      label: "Painting and symbols",
      families: ["paint", "eraser", "symbols"],
    },
    {
      id: "transform",
      label: "Transform and arrange",
      families: ["rotate", "mirror", "scale"],
    },
    {
      id: "navigation",
      label: "Canvas navigation",
      families: ["hand", "zoom"],
    },
  ].map((section) => ({
    ...section,
    families: section.families.map(
      (id) => TOOL_FAMILIES.find((family) => family.id === id)!,
    ),
  }));
  readonly flyout = signal<string | null>(null);
  readonly flyoutPosition = signal({ x: 52, y: 120 });
  readonly familyChoices = signal<Record<string, ToolId>>({});
  readonly alignToArtboard = signal(false);
  readonly transformAngle = signal(90);
  readonly transformScale = signal(100);
  readonly actionGroups = [
    {
      id: "organize",
      label: "Organize",
      icon: "group",
      commands: ["group", "ungroup"],
    },
    {
      id: "boolean",
      label: "Boolean operations",
      icon: "boolean",
      commands: ["union", "subtract", "intersect", "exclude"],
    },
    {
      id: "align",
      label: "Align",
      icon: "align",
      commands: [
        "alignLeft",
        "alignCenterX",
        "alignRight",
        "alignTop",
        "alignCenterY",
        "alignBottom",
        "distributeX",
        "distributeY",
      ],
    },
  ];
  readonly settings = signal(false);
  readonly commandList = COMMANDS;
  readonly recording = signal<string | null>(null);
  readonly toolGroup = signal("Draw");
  readonly cursorPoint = signal<{ x: number; y: number } | null>(null);
  readonly temporaryPan = signal(false);
  readonly temporarySelect = signal(false);
  readonly textEditing = signal<string | null>(null);
  readonly textDraft = signal("");
  readonly traceOptions = signal<TraceOptions>({
    mode: "mono",
    threshold: 128,
    levels: 3,
    ignoreWhite: true,
  });
  readonly symbolName = signal("");
  private spaceHeld = false;
  private panKey = "";
  private readonly contextScrollHandler = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest("xds-context-menu")) this.dismissContext();
  };
  private readonly wheelHandler = (event: WheelEvent) =>
    this.canvasWheel(event);
  readonly tools = TOOLS;
  readonly blends = BLENDS;
  readonly theme = signal(localStorage.getItem("xds-theme") ?? "dark");
  readonly locale = signal(localStorage.getItem("xds-locale") ?? "en");
  readonly panels = signal(true);
  readonly workspace = signal("Drawing");
  readonly about = signal(false);
  readonly spatial = signal(false);
  readonly dialog = signal(false);
  readonly projects = signal<{ id: string; name: string; updatedAt: string }[]>(
    [],
  );
  readonly apiToken = signal("");
  readonly releases = signal<Release[]>([]);
  readonly currentVersion = signal("…");
  readonly chosenVersion = signal("");
  readonly noteGroups = signal<{ title: string; items: string[] }[]>([]);
  readonly aboutError = signal("");
  readonly panelOrder = signal(["properties", "layers"]);
  private frame = 0;
  private pan?: { x: number; y: number; left: number; top: number };
  private disposeSpatial?: () => void;
  constructor(
    readonly editor: EditorService,
    readonly preferences: PreferencesService,
  ) {
    effect(() => {
      const config: SnapConfig = {
        zoom: editor.zoom(),
        rulers: { enabled: preferences.snapRulers(), visible: preferences.rulersVisible(), step: preferences.rulerStep(), radius: preferences.rulerSnapRadius() },
        grid: { enabled: preferences.snapGrid(), visible: preferences.gridVisible(), step: preferences.gridSize(), radius: preferences.gridSnapRadius() },
        guides: { enabled: preferences.snapGuides(), visible: preferences.guidesVisible(), radius: preferences.guideSnapRadius(), items: editor.document().layers.filter(layer => layer.guide && layer.visible && layer.id !== this.draggingGuideId()).map(layer => ({ axis: layer.guide === "vertical" ? "x" as const : "y" as const, position: layer.guide === "vertical" ? layer.x : layer.y })) },
      };
      editor.snapConfig.set(config);
    });
    effect(() => {
      editor.snapAngle.set(preferences.snapAngle());
    });
    effect(() => {
      editor.document();
      editor.selectedId();
      editor.selectedIds();
      editor.revision();
      editor.zoom();
      editor.tool();
      this.temporarySelect();
      editor.showHandles();
      editor.handleSize();
      this.textEditing();
      this.schedule();
    });
    effect(() => {
      window.document.documentElement.dataset["theme"] = this.theme();
      localStorage.setItem("xds-theme", this.theme());
    });
    effect(() => {
      window.document.documentElement.lang = this.locale();
      localStorage.setItem("xds-locale", this.locale());
    });
  }
  openCanvasContext(event: MouseEvent) {
    if (this.nativeEditingTarget(event) || !this.canvas) return;
    event.preventDefault();
    event.stopPropagation();
    this.showContext(this.editor.contextAt(this.point(event)), event);
  }
  openLayerContext(event: MouseEvent, id: string) {
    if (this.nativeEditingTarget(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.showContext(this.editor.contextForLayer(id, false), event);
  }
  private nativeEditingTarget(event: MouseEvent) {
    return event.target instanceof Element && !!event.target.closest('input,textarea,select,[contenteditable="true"]');
  }
  private showContext(target: ContextTarget | null, event: MouseEvent) {
    this.dismissMenus();
    this.flyout.set(null);
    this.paintPicker.set(null);
    this.cursorPoint.set(null);
    this.contextMenu.set(target ? { target, x: event.clientX, y: event.clientY } : null);
  }
  contextEntries(): ContextMenuEntry[] {
    const context = this.contextMenu();
    if (!context) return [];
    const definitions: Record<ContextAction, { label: string; section: string; command?: string }> = {
      hide: { label: "Hide", section: "visibility" },
      show: { label: "Show", section: "visibility" },
      backward: { label: "Send backward", section: "order" },
      forward: { label: "Bring forward", section: "order" },
      toBack: { label: "Send to back", section: "order" },
      toFront: { label: "Bring to front", section: "order" },
      delete: { label: "Delete", section: "edit", command: "remove" },
      corner: { label: "Convert to corner", section: "node" },
      smooth: { label: "Convert to smooth", section: "node" },
      collapseIncoming: { label: "Retract incoming handle", section: "handles" },
      collapseOutgoing: { label: "Retract outgoing handle", section: "handles" },
      expandIncoming: { label: "Extend incoming handle", section: "handles" },
      expandOutgoing: { label: "Extend outgoing handle", section: "handles" },
      deleteNode: { label: "Delete anchor", section: "edit" },
    };
    return this.editor.contextActions(context.target).map(action => {
      const definition = definitions[action.id];
      return { id: action.id, label: this.t(definition.label), section: definition.section, disabled: !action.enabled, shortcut: definition.command ? this.shortcut(definition.command) : undefined };
    });
  }
  executeContext(action: string) {
    const context = this.contextMenu();
    const enabled = context && this.contextEntries().some(entry => entry.id === action && !entry.disabled);
    this.dismissContext();
    if (context && enabled) this.editor.runContextAction(context.target, action as ContextAction);
  }
  dismissContext() { this.contextMenu?.set(null); }
  paintColor(target: "fill" | "stroke") {
    const selected = this.editor.selected();
    return selected && !selected.guide ? selected[target] : this.editor[target]();
  }
  paintWidth() { const selected = this.editor.selected(); return selected && !selected.guide ? selected.strokeWidth : this.editor.size(); }
  openPaint(target: "fill" | "stroke", event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.paintTarget.set(target);
    this.paintPicker.set({ x: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 260)), y: Math.max(8, Math.min(rect.top, window.innerHeight - 300)) });
  }
  paintBaseColor() {
    const color = this.paintColor(this.paintTarget());
    return color === "none" ? "#000000" : color.slice(0, 7);
  }
  paintOpacity() {
    const color = this.paintColor(this.paintTarget());
    return color === "none" ? 0 : color.length === 9 ? Math.round(parseInt(color.slice(7), 16) / 255 * 100) : 100;
  }
  setPaintBaseColor(color: string) {
    const current = this.paintColor(this.paintTarget());
    this.editor.setPaint(this.paintTarget(), color + (current.length === 9 ? current.slice(7) : ""));
  }
  setPaintOpacity(opacity: number) {
    if (!Number.isFinite(opacity)) return;
    const alpha = Math.round(Math.max(0, Math.min(100, opacity)) / 100 * 255).toString(16).padStart(2, "0");
    this.editor.setPaint(this.paintTarget(), this.paintBaseColor() + (alpha === "ff" ? "" : alpha));
  }
  @HostListener("document:pointerdown", ["$event"]) dismissPaint(event: PointerEvent) {
    if (!(event.target instanceof Element) || !event.target.closest(".paint-popover,.paint-trigger")) this.paintPicker.set(null);
  }
  setUnit(key: "distanceUnit" | "fontUnit", event: Event) { const unit = this.text(event); if (isUnit(unit)) this.preferences.setMeasurement(key, unit); }
  displayDistance(value: number) { return Number(fromPixels(value, this.preferences.distanceUnit()).toFixed(8)); }
  displayFontSize(value: number) { return Number(fromPixels(value, this.preferences.fontUnit()).toFixed(8)); }
  distanceInput(event: Event) { const value = this.number(event); return Number.isFinite(value) ? toPixels(value, this.preferences.distanceUnit()) : NaN; }
  setSymbolRadius(event: Event) { const value = this.distanceInput(event); if (Number.isFinite(value)) this.editor.symbolRadius.set(Math.max(5, Math.min(500, value))); }
  setPaintWidth(event: Event) { this.editor.setStrokeWidth(this.distanceInput(event)); }
  setToolSize(event: Event) { this.editor.size.set(this.clampSize(this.distanceInput(event))); }
  aidVisible(id: "rulers" | "guides" | "grid") { return this.preferences[`${id}Visible`](); }
  toggleAid(id: "rulers" | "guides" | "grid") { this.preferences.setMeasurement(`${id}Visible`, !this.aidVisible(id)); }
  aidSnaps(id: "rulers" | "guides" | "grid") { return id === "rulers" ? this.preferences.snapRulers() : id === "guides" ? this.preferences.snapGuides() : this.preferences.snapGrid(); }
  toggleSnap(id: "rulers" | "guides" | "grid") { this.preferences.setMeasurement(id === "rulers" ? "snapRulers" : id === "guides" ? "snapGuides" : "snapGrid", !this.aidSnaps(id)); }
  snapRadius(id: "rulers" | "guides" | "grid") { return id === "rulers" ? this.preferences.rulerSnapRadius() : id === "guides" ? this.preferences.guideSnapRadius() : this.preferences.gridSnapRadius(); }
  setSnapRadius(id: "rulers" | "guides" | "grid", value: number) { this.preferences.setMeasurement(id === "rulers" ? "rulerSnapRadius" : id === "guides" ? "guideSnapRadius" : "gridSnapRadius", value); }
  rulerTicks(axis: "vertical" | "horizontal") { return makeRulerTicks(axis === "vertical" ? this.editor.document().height : this.editor.document().width, this.editor.zoom(), this.preferences.distanceUnit(), this.preferences.rulerStep()); }
  gridSpacing() { return this.preferences.gridSize() * this.editor.zoom(); }
  visibleGuides() { return this.editor.document().layers.filter((layer) => layer.guide && layer.visible); }
  startGuide(event: PointerEvent, axis: "vertical" | "horizontal", id?: string) {
    if (event.button !== 0 || !this.canvas) return;
    event.preventDefault();
    event.stopPropagation();
    this.commitText();
    const point = this.point(event);
    const guideId = this.editor.beginGuideDrag(axis, axis === "vertical" ? point.x : point.y, id);
    if (!guideId) return;
    this.draggingGuideId.set(guideId);
    this.editor.selectLayer(guideId);
    this.preferences.setMeasurement("guidesVisible", true);
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    this.guideDrag = { axis, pointerId: event.pointerId, element };
  }
  moveGuide(event: PointerEvent) {
    if (!this.guideDrag || this.guideDrag.pointerId !== event.pointerId) return;
    const raw = this.point(event);
    const config = this.editor.snapConfig();
    const point = config ? snapPoint(raw, { ...config, guides: { ...config.guides, items: this.editor.document().layers.filter(layer => layer.guide && layer.visible && layer.id !== this.draggingGuideId()).map(layer => ({ axis: layer.guide === "vertical" ? "x" as const : "y" as const, position: layer.guide === "vertical" ? layer.x : layer.y })) } }) : raw;
    this.editor.updateGuideDrag(this.guideDrag.axis === "vertical" ? point.x : point.y);
  }
  finishGuide(event: PointerEvent) {
    if (!this.guideDrag || this.guideDrag.pointerId !== event.pointerId) return;
    this.moveGuide(event);
    const point = this.point(event), doc = this.editor.document();
    this.editor.endGuideDrag(point.x >= 0 && point.y >= 0 && point.x <= doc.width && point.y <= doc.height);
    this.releaseGuideCapture();
  }
  cancelGuide() { if (this.guideDrag) this.editor.cancelGuideDrag(); this.releaseGuideCapture(); }
  private releaseGuideCapture() {
    const drag = this.guideDrag;
    this.guideDrag = undefined;
    this.draggingGuideId.set(null);
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }
  dragLayer(event: DragEvent, id: string) { event.stopPropagation(); event.dataTransfer?.setData("text/x-xds-layer", id); }
  dropLayer(event: DragEvent, id: string) {
    event.preventDefault(); event.stopPropagation();
    const source = event.dataTransfer?.getData("text/x-xds-layer");
    if (!source) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.editor.reorderLayer(source, id, event.clientY < rect.top + rect.height / 2 ? "after" : "before");
  }
  clampSize(value: number) {
    return Number.isFinite(value) ? Math.max(1, Math.min(200, value)) : 4;
  }
  t(key: string) {
    return translate(key, this.locale());
  }
  ngAfterViewInit() {
    document.addEventListener("scroll", this.contextScrollHandler, true);
    this.viewport?.nativeElement.addEventListener("wheel", this.wheelHandler, {
      passive: false,
    });
    this.fit();
    this.schedule();
    void this.loadReleaseIndex();
    if (location.pathname === "/about") this.about.set(true);
  }
  ngOnDestroy() {
    document.removeEventListener("scroll", this.contextScrollHandler, true);
    this.viewport?.nativeElement.removeEventListener(
      "wheel",
      this.wheelHandler,
    );
    cancelAnimationFrame(this.frame);
    this.disposeSpatial?.();
  }
  schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (this.canvas)
        this.editor.renderer.draw(
          this.canvas.nativeElement,
          this.renderDocument(),
          this.editor.selectedLayers().map((l) => l.id),
          () => this.schedule(),
          this.editor.painting,
          false,
          {
            zoom: this.editor.zoom(),
            direct: this.editor.isEditingCurve() || [
              "select",
              "direct",
              "pen",
              "addAnchor",
              "deleteAnchor",
              "convertAnchor",
            ].includes(this.activeTool()),
            showHandles: this.editor.showHandles(),
            handleSize: this.editor.handleSize(),
          },
        );
    });
  }
  private point(event: MouseEvent) {
    const rect = this.canvas!.nativeElement.getBoundingClientRect();
    return {
      x:
        ((event.clientX - rect.left) * this.editor.document().width) /
        rect.width,
      y:
        ((event.clientY - rect.top) * this.editor.document().height) /
        rect.height,
    };
  }
  pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.canvas!.nativeElement.setPointerCapture(event.pointerId);
    this.commitText();
    this.temporarySelect.set(event.ctrlKey);
    const tool = this.activeTool();
    if (tool === "zoom" && !this.temporaryPan()) {
      this.setZoom(this.editor.zoom() * (event.altKey ? 0.8 : 1.25));
      return;
    }
    if (tool === "hand" || this.temporaryPan()) {
      const view = this.viewport!.nativeElement;
      this.pan = {
        x: event.clientX,
        y: event.clientY,
        left: view.scrollLeft,
        top: view.scrollTop,
      };
    } else {
      this.editor.start(
        this.point(event),
        {
          shift: event.shiftKey,
          alt: event.altKey,
          ctrl: event.ctrlKey,
        },
        this.temporarySelect() ? "select" : undefined,
      );
      if (tool === "text") {
        this.editor.end();
        this.editText();
      }
    }
  }
  pointerMove(event: PointerEvent) {
    this.cursorPoint.set({ x: event.clientX, y: event.clientY });
    if (this.pan) {
      const view = this.viewport!.nativeElement;
      view.scrollLeft = this.pan.left - event.clientX + this.pan.x;
      view.scrollTop = this.pan.top - event.clientY + this.pan.y;
    } else
      this.editor.move(this.point(event), {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
      });
  }
  pointerUp() {
    this.pan = undefined;
    this.editor.end();
  }
  pointerCancel() {
    if (this.guideDrag) this.cancelGuide();
    this.pan = undefined;
    this.editor.cancel();
  }
  private renderDocument() {
    const doc = this.editor.document(),
      id = this.textEditing();
    return id
      ? {
          ...doc,
          layers: doc.layers.map((l) => (l.id === id ? { ...l, text: "" } : l)),
        }
      : doc;
  }
  editText() {
    const layer = this.editor.selected();
    if (!layer || layer.kind !== "text" || layer.locked) return;
    this.textEditing.set(layer.id);
    this.textDraft.set(layer.text);
    requestAnimationFrame(() => {
      const input = window.document.querySelector<HTMLTextAreaElement>(
        ".inline-text-editor",
      );
      input?.focus();
      input?.select();
    });
  }
  textTransform(layer: Layer) {
    return `rotate(${layer.rotation}deg) skewX(${layer.skewX ?? 0}deg) scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`;
  }
  commitText() {
    const id = this.textEditing();
    if (!id) return;
    this.textEditing.set(null);
    const layer = this.editor.document().layers.find((l) => l.id === id);
    if (layer && !layer.locked && layer.text !== this.textDraft()) {
      this.editor.selectedId.set(id);
      const text = this.textDraft().slice(0, 2000);
      this.editor.updateLayer({
        text,
        height: Math.min(
          16384,
          Math.max(
            layer.height,
            text.split("\n").length * layer.fontSize * 1.2,
          ),
        ),
      });
    }
  }
  textKey(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.textEditing.set(null);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.commitText();
    }
  }
  canvasWheel(event: WheelEvent) {
    if (
      !isCanvasZoomGesture(
        event.ctrlKey || event.metaKey,
        this.spaceHeld,
        false,
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (this.textEditing() || this.settings() || this.about() || this.dialog())
      return;
    this.setZoom(
      canvasWheelZoom(
        this.editor.zoom(),
        event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1),
      ),
    );
  }
  familyTool(family: ToolFamily) {
    const id = family.tools.includes(this.activeTool())
      ? this.activeTool()
      : (this.familyChoices()[family.id] ?? family.tools[0]);
    return this.tools.find((t) => t.id === id)!;
  }
  toggleFlyout(id: string, event: MouseEvent) {
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    const rail = trigger.closest(".toolrail")?.getBoundingClientRect();
    this.flyoutPosition.set({
      x: (rail?.right ?? rect.right) + 8,
      y: Math.max(8, Math.min(rect.top, window.innerHeight - 340)),
    });
    this.flyout.set(this.flyout() === id ? null : id);
  }
  flyoutTools() {
    return (
      this.families
        .find((f) => f.id === this.flyout())
        ?.tools.map((id) => this.tools.find((t) => t.id === id)!) ?? []
    );
  }
  flyoutActions() {
    const id = this.flyout();
    return (
      this.actionGroups.find((g) => g.id === id)?.commands ??
      (
        {
          rotate: ["rotateCW", "rotateCCW"],
          mirror: ["mirrorH", "mirrorV"],
          scale: ["scaleUp", "scaleDown"],
          zoom: ["zoomIn", "zoomOut", "fit"],
        } as Record<string, string[]>
      )[id ?? ""] ??
      []
    );
  }
  commandLabel(id: string) {
    return this.commandList.find((c) => c.id === id)?.label ?? id;
  }
  commandTitle(id: string) {
    return (
      this.t(this.commandLabel(id)) +
      (this.shortcut(id) ? " (" + this.shortcut(id) + ")" : "")
    );
  }
  runCommand(id: string) {
    this.flyout.set(null);
    if (id === "group" || id === "ungroup") {
      this.editor.group(id === "ungroup");
      return;
    }
    if (["union", "subtract", "intersect", "exclude"].includes(id)) {
      this.editor.boolean(id as "union" | "subtract" | "intersect" | "exclude");
      return;
    }
    const align: Record<
      string,
      | "left"
      | "centerX"
      | "right"
      | "top"
      | "centerY"
      | "bottom"
      | "distributeX"
      | "distributeY"
    > = {
      alignLeft: "left",
      alignCenterX: "centerX",
      alignRight: "right",
      alignTop: "top",
      alignCenterY: "centerY",
      alignBottom: "bottom",
      distributeX: "distributeX",
      distributeY: "distributeY",
    };
    if (align[id]) {
      try {
        this.editor.arrange(align[id], this.alignToArtboard());
      } catch (error) {
        this.notify(error);
      }
      return;
    }
    const actions: Record<string, () => void> = {
      selectAll: () => this.editor.selectAll(),
      mirrorH: () => this.editor.reflect("horizontal"),
      mirrorV: () => this.editor.reflect("vertical"),
      rotateCW: () => this.editor.transformBy(90),
      rotateCCW: () => this.editor.transformBy(-90),
      scaleUp: () => this.editor.transformBy(0, 2),
      scaleDown: () => this.editor.transformBy(0, 0.5),
      zoomIn: () => this.setZoom(this.editor.zoom() * 1.25),
      zoomOut: () => this.setZoom(this.editor.zoom() * 0.8),
      fit: () => this.fit(),
    };
    actions[id]?.();
  }
  @HostListener("document:pointerdown", ["$event"]) dismissToolFlyout(
    event: PointerEvent,
  ) {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !target.closest(".tool-family,.tool-flyout")
    )
      this.flyout.set(null);
  }
  groupTools() {
    return this.tools.filter((tool) => tool.group === this.toolGroup());
  }
  activeTool(): ToolId {
    return this.temporarySelect() && !this.editor.isEditingCurve()
      ? "select"
      : this.editor.tool();
  }
  toolIcon() {
    return this.temporaryPan()
      ? "hand"
      : (this.tools.find((t) => t.id === this.activeTool())?.icon ?? "select");
  }
  cursorAxesPoint() {
    const cursor = this.cursorPoint();
    if (
      !cursor ||
      !this.preferences.cursorAxes() ||
      !this.canvas ||
      this.textEditing() ||
      this.settings() ||
      this.about() ||
      this.dialog() ||
      this.spatial()
    )
      return null;
    const viewport = this.viewport?.nativeElement;
    if (viewport) {
      const bounds = viewport.getBoundingClientRect();
      const left = bounds.left + viewport.clientLeft;
      const top = bounds.top + viewport.clientTop;
      if (
        cursor.x < left ||
        cursor.y < top ||
        cursor.x >= left + viewport.clientWidth ||
        cursor.y >= top + viewport.clientHeight
      )
        return null;
    }
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = cursor.x - rect.left;
    const y = cursor.y - rect.top;
    return x >= 0 && y >= 0 && x < rect.width && y < rect.height
      ? { x, y }
      : null;
  }
  refreshCursorPosition() {
    this.dismissContext();
    this.cursorPoint.update((cursor) => (cursor ? { ...cursor } : null));
  }
  toolCursor() {
    if (this.preferences.cursorAxes()) return "none";
    return this.temporaryPan() || this.activeTool() === "hand"
      ? "grab"
      : this.activeTool() === "text"
        ? "text"
        : ["select", "direct"].includes(this.activeTool())
          ? "default"
          : "crosshair";
  }
  shortcut(id: string) {
    return (this.preferences.bindings()[id] ?? []).join(" / ");
  }
  chooseTool(id: ToolId) {
    this.commitText();
    this.editor.setTool(id);
    const family = this.families.find((f) => f.tools.includes(id));
    if (family) this.familyChoices.update((c) => ({ ...c, [family.id]: id }));
    this.flyout.set(null);
  }
  shapeFields() {
    const fields: Record<string, string[][]> = {
      rounded: [["radius", "Corner radius"]],
      polygon: [["sides", "Sides"]],
      star: [
        ["sides", "Sides"],
        ["inner", "Inner radius ratio"],
      ],
      spiral: [
        ["turns", "Turns"],
        ["decay", "Decay"],
      ],
      grid: [
        ["rows", "Rows"],
        ["columns", "Columns"],
      ],
      polar: [
        ["rings", "Rings"],
        ["rays", "Rays"],
      ],
      flare: [
        ["rings", "Rings"],
        ["rays", "Rays"],
      ],
    };
    return fields[this.editor.tool()] ?? [];
  }
  shapeOption(key: keyof ShapeOptions, event: Event) {
    const value = this.number(event);
    if (Number.isFinite(value))
      this.editor.shapeOptions.update((o) => ({
        ...o,
        [key]: Math.max(0.05, Math.min(200, key === "radius" ? toPixels(value, this.preferences.distanceUnit()) : value)),
      }));
  }
  captureKey(event: KeyboardEvent, id: string) {
    if (this.recording() !== id) return;
    event.preventDefault();
    event.stopPropagation();
    const chord = eventChord(event);
    if (chord && this.preferences.assign(id, [chord])) this.recording.set(null);
  }
  async symbolsInput(event: Event) {
    const input = event.target as HTMLInputElement;
    try {
      const file = input.files?.[0];
      if (file) {
        if (file.size > 35_000_000) throw new Error("Project exceeds 35 MB.");
        this.editor.importSymbols(await file.text());
      }
    } catch (error) {
      this.notify(error);
    }
    input.value = "";
  }
  traceOption(key: keyof TraceOptions, value: unknown) {
    if (key === "mode" && !["mono", "gray", "color"].includes(String(value)))
      return;
    if (
      (key === "levels" || key === "threshold") &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      return;
    const safe =
      key === "levels"
        ? Math.round(Math.max(2, Math.min(8, value as number)))
        : key === "threshold"
          ? Math.max(0, Math.min(255, value as number))
          : value;
    this.traceOptions.update((o) => ({ ...o, [key]: safe }));
  }
  trace() {
    void this.editor
      .traceImage(this.traceOptions())
      .catch((error) => this.notify(error));
  }
  fit() {
    const view = this.viewport?.nativeElement;
    if (view)
      this.editor.zoom.set(
        Math.max(
          0.1,
          Math.min(
            1,
            (view.clientWidth - 100) / this.editor.document().width,
            (view.clientHeight - 100) / this.editor.document().height,
          ),
        ),
      );
  }
  setZoom(value: number) {
    this.editor.zoom.set(Math.min(3, Math.max(0.1, value)));
  }
  number(event: Event) {
    return Number((event.target as HTMLInputElement).value);
  }
  text(event: Event) {
    return (event.target as HTMLInputElement).value;
  }
  patchNumber(
    key:
      | "x"
      | "y"
      | "width"
      | "height"
      | "rotation"
      | "opacity"
      | "fontSize"
      | "strokeWidth",
    event: Event,
  ) {
    let value = this.number(event);
    if (!Number.isFinite(value)) return;
    const limits: Record<string, [number, number]> = {
      x: [-100000, 100000],
      y: [-100000, 100000],
      width: [1, 16384],
      height: [1, 16384],
      rotation: [-360, 360],
      opacity: [0, 1],
      fontSize: [1, 500],
      strokeWidth: [0, 200],
    };
    if (["x", "y", "width", "height", "strokeWidth", "fontSize"].includes(key))
      value = toPixels(value, key === "fontSize" ? this.preferences.fontUnit() : this.preferences.distanceUnit());
    value = Math.min(limits[key][1], Math.max(limits[key][0], value));
    this.editor.updateLayer({ [key]: value });
  }
  adjustment(
    key: "brightness" | "contrast" | "saturation" | "blur",
    event: Event,
  ) {
    const layer = this.editor.selected();
    if (layer)
      this.editor.updateLayer({
        adjustments: { ...layer.adjustments, [key]: key === "blur" ? Math.max(0, Math.min(30, this.distanceInput(event))) : this.number(event) },
      });
  }
  resetAdjustments() {
    this.editor.updateLayer({
      adjustments: { brightness: 100, contrast: 100, saturation: 100, blur: 0 },
    });
  }
  async imageInput(event: Event) {
    const input = event.target as HTMLInputElement;
    try {
      if (input.files?.[0]) await this.editor.importImage(input.files[0]);
    } catch (error) {
      this.notify(error);
    }
    input.value = "";
  }
  async projectInput(event: Event) {
    const input = event.target as HTMLInputElement;
    try {
      const file = input.files?.[0];
      if (file) {
        if (file.size > 35_000_000) throw new Error("Project exceeds 35 MB.");
        this.editor.open(await file.text());
        this.fit();
      }
    } catch (error) {
      this.notify(error);
    }
    input.value = "";
  }
  newDocument() {
    if (
      this.editor.document().layers.length &&
      !confirm("Create a new document? Save your current project first.")
    )
      return;
    this.editor.reset();
    this.fit();
  }
  sample() {
    this.commitText();
    this.editor.open(JSON.stringify(createSampleDocument()));
    this.editor.selectedId.set(null);
    this.editor.selectedIds.set([]);
    this.fit();
  }
  dropPanel(event: DragEvent, target: string) {
    event.preventDefault();
    const id = event.dataTransfer?.getData("text/x-xds-panel");
    if (!id || !this.panelOrder().includes(id)) return;
    const list = this.panelOrder().filter((x) => x !== id);
    list.splice(list.indexOf(target), 0, id);
    this.panelOrder.set(list);
  }
  dragPanel(event: DragEvent, id: string) {
    event.dataTransfer?.setData("text/x-xds-panel", id);
  }
  notify(error: unknown) {
    this.editor.status.set(
      error instanceof Error
        ? error.message
        : "The operation could not be completed.",
    );
  }
  private dismissMenus(except?: HTMLDetailsElement) {
    let dismissed = false;
    for (const menu of window.document.querySelectorAll<HTMLDetailsElement>(
      ".menus details[open]",
    )) {
      if (menu === except) continue;
      menu.open = false;
      dismissed = true;
    }
    return dismissed;
  }
  @HostListener("document:pointerdown", ["$event"]) dismissOutsideMenus(
    event: PointerEvent,
  ) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".menus details"))
      this.dismissMenus();
  }
  @HostListener("document:click", ["$event"]) closeMenus(event: MouseEvent) {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest(".tool-family,.tool-flyout")
    )
      this.flyout.set(null);
    const target = event.target;
    const summary =
      target instanceof Element ? target.closest(".menus summary") : null;
    const active = summary?.parentElement;
    this.dismissMenus(
      active instanceof HTMLDetailsElement ? active : undefined,
    );
  }
  @HostListener("window:keydown", ["$event"]) key(event: KeyboardEvent) {
    if (this.contextMenu?.()) {
      if (event.key === "Escape") { this.dismissContext(); event.preventDefault(); }
      return;
    }
    if (!event.isComposing) this.temporarySelect.set(event.ctrlKey);
    if (
      event.key === "Escape" &&
      !event.isComposing &&
      !this.recording() &&
      this.flyout()
    ) {
      this.flyout.set(null);
      event.preventDefault();
      return;
    }
    if (
      event.key === "Escape" &&
      !event.isComposing &&
      !this.recording() &&
      this.dismissMenus()
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && this.paintPicker?.()) { this.paintPicker.set(null); event.preventDefault(); return; }
    if (event.code === "Space" && !event.isComposing) this.spaceHeld = true;
    const target = event.target as HTMLElement;
    if (
      event.isComposing ||
      target?.closest('input,textarea,select,[contenteditable="true"]') ||
      this.about() ||
      this.dialog() ||
      this.settings() ||
      this.textEditing() ||
      this.spatial()
    )
      return;
    if (event.code === "Space") {
      this.spaceHeld = true;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        return;
      }
    }
    const command = matchShortcut(this.preferences.bindings(), event);
    if (!command) return;
    event.preventDefault();
    if (command === "panHold") {
      this.temporaryPan.set(true);
      this.panKey = event.code;
      return;
    }
    if (
      event.repeat &&
      ![
        "left",
        "right",
        "up",
        "down",
        "leftFast",
        "rightFast",
        "upFast",
        "downFast",
      ].includes(command)
    )
      return;
    if (command.startsWith("tool.")) {
      this.chooseTool(command.slice(5) as ToolId);
      return;
    }
    const action: Record<string, () => void> = {
      about: () => this.openAbout(),
      importImage: () => this.imageFile?.nativeElement.click(),
      exportPng: () => {
        void this.editor.exportPng();
      },
      exportSvg: () => this.editor.exportSvg(),
      undo: () => this.editor.undo(),
      redo: () => this.editor.redo(),
      save: () => this.editor.save(),
      open: () => this.projectFile?.nativeElement.click(),
      new: () => this.newDocument(),
      duplicate: () => this.editor.duplicate(),
      remove: () => this.editor.remove(),
      finish: () => this.editor.finishPath(),
      cancel: () => {
        if (this.guideDrag) this.cancelGuide();
        this.editor.cancel();
        this.editor.finishPath();
      },
      fit: () => this.fit(),
      settings: () => this.settings.set(true),
    };
    if (action[command]) action[command]();
    else if (
      ![
        "left",
        "right",
        "up",
        "down",
        "leftFast",
        "rightFast",
        "upFast",
        "downFast",
      ].includes(command)
    )
      this.runCommand(command);
    else {
      const amount = command.endsWith("Fast") ? 10 : 1;
      this.editor.nudge(
        command.startsWith("left")
          ? -amount
          : command.startsWith("right")
            ? amount
            : 0,
        command.startsWith("up")
          ? -amount
          : command.startsWith("down")
            ? amount
            : 0,
      );
    }
  }
  @HostListener("window:keyup", ["$event"]) keyUp(event: KeyboardEvent) {
    this.temporarySelect.set(event.ctrlKey);
    if (event.code === "Space") this.spaceHeld = false;
    if (event.code === this.panKey) {
      this.temporaryPan.set(false);
      this.panKey = "";
    }
  }
  @HostListener("window:blur") resetInput() {
    this.dismissContext();
    this.dismissMenus();
    this.flyout.set(null);
    this.spaceHeld = false;
    this.temporaryPan.set(false);
    this.temporarySelect.set(false);
    this.panKey = "";
    this.pointerCancel();
    this.cursorPoint.set(null);
  }
  async loadReleaseIndex() {
    try {
      const response = await fetch("/assets/changelog/index.json");
      if (!response.ok) throw new Error("Release notes unavailable");
      const data = await response.json();
      this.releases.set(data.entries);
      this.currentVersion.set(data.currentVersion);
      await this.selectVersion(
        new URLSearchParams(location.search).get("version") ??
          data.currentVersion,
        false,
      );
    } catch (error) {
      this.aboutError.set(
        error instanceof Error ? error.message : "Release notes unavailable",
      );
    }
  }
  async selectVersion(version: string, updateUrl = true) {
    this.chosenVersion.set(version);
    const entry = this.releases().find((r) => r.version === version);
    this.noteGroups.set([]);
    if (!entry) {
      this.aboutError.set("Unknown version. Select an available release.");
      return;
    }
    this.aboutError.set("");
    if (updateUrl)
      history.pushState(
        {},
        "",
        `/about?version=${encodeURIComponent(version)}`,
      );
    try {
      const response = await fetch(
        "/assets/changelog/" + encodeURIComponent(entry.markdown),
      );
      if (!response.ok) throw new Error("Release notes unavailable");
      const markdown = await response.text(),
        parts = markdown.split(/^## (.+)$/m),
        groups = [];
      for (let i = 1; i < parts.length; i += 2)
        groups.push({
          title: parts[i],
          items: parts[i + 1]
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => line.replace(/^- /, "")),
        });
      this.noteGroups.set(groups);
    } catch (error) {
      this.notify(error);
      this.aboutError.set("Release notes unavailable");
    }
  }
  openAbout() {
    this.dismissContext();
    this.about.set(true);
    void this.selectVersion(this.currentVersion());
  }
  closeAbout() {
    this.about.set(false);
    history.pushState({}, "", "/");
  }
  @HostListener("window:popstate") route() {
    this.dismissContext();
    this.about.set(location.pathname === "/about");
    if (this.about())
      void this.selectVersion(
        new URLSearchParams(location.search).get("version") ??
          this.currentVersion(),
        false,
      );
  }
  async serverRequest(path: string, method = "GET", body?: unknown) {
    const response = await fetch("/api/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + this.apiToken(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Enter the local API token from your environment file."
          : `Server request failed (${response.status}).`,
      );
    return response.json();
  }
  async refreshProjects() {
    try {
      this.projects.set(await this.serverRequest("projects"));
      this.editor.status.set("Connected to local document service");
    } catch (error) {
      this.notify(error);
    }
  }
  async saveServer() {
    try {
      await this.serverRequest("projects", "POST", this.editor.document());
      await this.refreshProjects();
      this.editor.status.set("Project saved to local server");
    } catch (error) {
      this.notify(error);
    }
  }
  async openServer(id: string) {
    try {
      const doc = await this.serverRequest(
        "projects/" + encodeURIComponent(id),
      );
      this.editor.open(JSON.stringify(doc));
      this.dialog.set(false);
      this.fit();
    } catch (error) {
      this.notify(error);
    }
  }
  async spatialPreview() {
    this.spatial.set(true);
    try {
      const { createSpatialPreview } = await import("./spatial");
      requestAnimationFrame(async () => {
        try {
          if (this.spatialHost) {
            const dispose = await createSpatialPreview(
              this.spatialHost.nativeElement,
              this.editor.document(),
              this.editor.renderer,
            );
            if (this.spatial()) this.disposeSpatial = dispose;
            else dispose();
          }
        } catch (error) {
          this.notify(error);
          this.closeSpatial();
        }
      });
    } catch (error) {
      this.notify(error);
      this.closeSpatial();
    }
  }
  closeSpatial() {
    this.disposeSpatial?.();
    this.disposeSpatial = undefined;
    this.spatial.set(false);
  }
}
