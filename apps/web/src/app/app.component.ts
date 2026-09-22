import { Procedural, ProceduralKind } from "../../../../packages/domain/src/procedural";
import { Dimension, DimensionFormat, dimensionGeometry } from "../../../../packages/domain/src/dimensions";
import { defaultLineEnds, lineEndGeometry, LineEnd, LineEnds } from "../../../../packages/domain/src/line-endings";
import { LeafType, LEAF_TYPES } from "../../../../packages/domain/src/procedural";
import { BrushSettings, BrushType, BRUSH_TYPES, brushStamps, previewStroke } from "../../../../packages/domain/src/brush";
import { ArraySettings, DEFAULT_ARRAY, validArraySettings } from "../../../../packages/domain/src/array-copy";
import { defaultMarginGuides, MarginGuides, PAGE_FORMATS, PAGE_RESOLUTIONS, PageCategory, PageOrientation, pageSize, pageSizeFits, RegistrationMarks, REGISTRATION_MARKS, registrationFits } from "../../../../packages/domain/src/page-setup";
import { BlendEasing } from "../../../../packages/domain/src/object-blend";
import { FONT_FAMILIES, defaultTypography, defaultTextLayout, TextTypography, TextLayoutOptions } from "../../../../packages/domain/src/text-layout";
import { measurementUnits, isUnit, snapPoint, fromPixels, toPixels, formatMeasurement, rulerTicks as makeRulerTicks, SnapConfig } from "../../../../packages/domain/src/measurements";
import { PreferencesService } from "./preferences.service";
import { DEFAULT_SIMPLIFY, FreehandToolOptions, PAINTBRUSH_DEFAULTS, PENCIL_DEFAULTS, SMOOTH_DEFAULTS, SimplifyOptions, validFreehandTool } from "../../../../packages/domain/src/path-fit";
import { BrushStroke, DEFAULT_BRUSH_STROKE } from "../../../../packages/domain/src/brush-stroke";
import {
  COMMANDS,
  eventChord,
  matchShortcut,
} from "../../../../packages/domain/src/shortcuts";
import {
  canvasWheelZoom,
  isCanvasZoomGesture,
} from "../../../../packages/domain/src/input";
import { EDGE_ZONE, LONG_PRESS_MS, LONG_PRESS_SLOP, edgeSwipe, pairOf, twoFingerChange, zoomAround } from "../../../../packages/domain/src/touch";
import { selectionBounds } from "../../../../packages/domain/src/arrange";
/** The width below which the studio lays itself out for a phone. */
const PHONE_QUERY = "(max-width: 720px)";
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
import { NgTemplateOutlet } from "@angular/common";
import type { SpatialPreview } from "./spatial";
/** The commands a text field keeps for itself, because they edit the text it holds. */
const FIELD_COMMANDS = ["undo", "redo", "copy", "cut", "paste", "pasteInFront", "pasteInBack", "selectAll", "remove", "finish", "cancel", "panHold"];
import { EditorService, ContextAction, ContextTarget } from "./editor.service";
import { ContextMenuComponent, ContextMenuEntry } from "./context-menu.component";
import { SmartTableComponent } from "./smart-table.component";
import { TOOLS, ToolId, TOOL_FAMILIES, ToolFamily } from "./tools";
import { translate } from "./i18n";
import { BLENDS, Layer, StrokeStyle, blankDocument, defaultStrokeStyle, svgExport } from "../../../../packages/domain/src/document";
import { LIQUIFY_DEFAULTS, LiquifyOptions, LiquifyTool } from "../../../../packages/domain/src/liquify";
import { DEFAULT_WARP, WARP_LABELS, WARP_STYLES, WarpSettings } from "../../../../packages/domain/src/envelope";
import { COLOR_MODES, ColorMode, GradientPaint, PatternDefinition, PRESET_PATTERNS, PresetPattern, Swatch, cmykToRgb, gradientColorAt, grayToRgb, presetPattern, renderedStops, rgbToCmyk, rgbToGray, validGradient } from "../../../../packages/domain/src/paint";
import { createSampleDocument } from "../../../../packages/domain/src/sample";
interface Release {
  version: string;
  date: string;
  summary: string;
  markdown: string;
  breakingChanges: string[];
}
/** Dash presets offered beside the six dash and gap fields; the last choice is a custom sequence. */
const DASH_PRESETS: { id: string; label: string; dash: number[] }[] = [
  { id: "solid", label: "Solid line", dash: [] },
  { id: "dashed", label: "Dashed line", dash: [12, 6] },
  { id: "dotted", label: "Dotted line", dash: [1, 4] },
  { id: "axis", label: "Axis line", dash: [24, 6, 4, 6] },
  { id: "custom", label: "Custom sequence", dash: [] },
];
const DASH_FIELDS = [0, 1, 2, 3, 4, 5];
const ARRAY_MODES = [
  { id: "linear", label: "Linear series" },
  { id: "circular", label: "Circular series" },
  { id: "grid", label: "Grid series" },
] as const;
const BLEND_LIMIT_TIP = "Endpoints are excluded from the step count.";
const BRUSH_TYPE_LABELS: Record<BrushType, string> = {
  round: "Round brush", flat: "Flat brush", calligraphy: "Calligraphy brush",
  marker: "Marker", airbrush: "Airbrush", pencil: "Pencil brush",
};
const BACKGROUND_SWATCHES = [
  { value: "#000000", label: "Black" },
  { value: "#ffffff", label: "White" },
  { value: "#1b4fa0", label: "Blueprint blue" },
  { value: "#00b140", label: "Chroma key" },
  { value: "none", label: "No color" },
];
const PAGE_EDGE_KEYS: ("top" | "right" | "bottom" | "left")[] = ["top", "right", "bottom", "left"];
const REGISTRATION_LABELS: Record<string, string> = {
  none: "No marks", file2: "Two filing holes", file4: "Four filing holes",
  file6: "Six filing holes", file8: "Eight filing holes", animation: "Animation peg bar",
};
const PAGE_CATEGORIES: { id: PageCategory; label: string }[] = [
  { id: "paper", label: "Paper sizes" },
  { id: "screen", label: "Screen sizes" },
  { id: "animation", label: "Animation templates" },
];
/** Command icons follow the shapes used by drawing programs for pathfinder, align and transform actions. */
const COMMAND_ICONS: Record<string, string> = {
  union: "union", subtract: "subtract", intersect: "intersect", exclude: "exclude",
  alignLeft: "alignLeft", alignCenterX: "alignCenterX", alignRight: "alignRight",
  alignTop: "alignTop", alignCenterY: "alignCenterY", alignBottom: "alignBottom",
  distributeX: "distributeX", distributeY: "distributeY",
  group: "group", ungroup: "ungroup",
  makeBlend: "object-blend", expandBlend: "blend-expand", releaseBlend: "blend-release",
  mirrorH: "mirror-h", mirrorV: "mirror-v", rotateCW: "rotate-cw", rotateCCW: "rotate-ccw",
  scaleUp: "scale-up", scaleDown: "scale-down",
  duplicate: "duplicate", transformAgain: "transform-again", remove: "delete", undo: "undo", redo: "redo",
  outlineStroke: "outline-stroke", outlineText: "outline-text",
  copy: "copy", cut: "cut", paste: "paste", pasteInFront: "paste-front", pasteInBack: "paste-back",
  duplicateSeries: "duplicate-series",
  layerUp: "layer-up", layerDown: "layer-down", fit: "fit-view", zoomIn: "zoom-in", zoomOut: "zoom-out",
};
const LEAF_TYPE_LABELS: Record<string, string> = { swing: "Hinged", sliding: "Sliding", folding: "Folding", pocket: "Pocket", fixed: "Fixed glazing", opening: "Passage without leaves" };

@Component({
  selector: "xds-root",
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, ContextMenuComponent, SmartTableComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild("settingsNav") set settingsNavHost(element: ElementRef<HTMLElement> | undefined) {
    if (element && this.settings())
      element.nativeElement.querySelector<HTMLElement>("#settings-tab-" + this.settingsCategory())?.focus();
  }
  @ViewChild("canvas") canvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild("viewport") viewport?: ElementRef<HTMLDivElement>;
  @ViewChild("spatialHost") spatialHost?: ElementRef<HTMLDivElement>;
  @ViewChild("imageFile") imageFile?: ElementRef<HTMLInputElement>;
  @ViewChild("projectFile") projectFile?: ElementRef<HTMLInputElement>;
  readonly blendSteps = signal(5);
  readonly blendEasing = signal<BlendEasing>("linear");
  readonly blendEasings = [
    { id: "linear", label: "Linear" },
    { id: "ease-in", label: "Ease in" },
    { id: "ease-out", label: "Ease out" },
    { id: "ease-in-out", label: "Ease in and out" },
  ] as const;
  readonly blendActions = [
    { id: "makeBlend", label: "Make blend", icon: "object-blend", hint: "Create intermediate objects from the back object to the front object." },
    { id: "expandBlend", label: "Expand blend", icon: "blend-expand", hint: "Convert the linked steps into independently editable objects." },
    { id: "releaseBlend", label: "Release blend", icon: "blend-release", hint: "Remove intermediate objects and retain the editable endpoints." },
  ] as const;
  readonly fontFamilies = FONT_FAMILIES;
  readonly fontWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  readonly textSizingActions = [
    { id: "content", icon: "text-fit-content", label: "Fit frame to content", hint: "Resize both frame dimensions to the text. Disables wrapping and fitting." },
    { id: "width", icon: "text-auto-width", label: "Automatic width", hint: "Resize frame width to the text and keep its height. Disables wrapping and fitting." },
    { id: "height", icon: "text-auto-height", label: "Automatic height", hint: "Resize frame height to the text and keep its width. Disables fitting." },
  ] as const;
  readonly textAlignments = ["left", "center", "right", "justify"] as const;
  readonly typographyFields = [
    { key: "lineHeight", label: "Leading", icon: "text-leading", min: 0, max: 2000, hint: "Baseline spacing; zero uses automatic leading." },
    { key: "letterSpacing", label: "Letter spacing", icon: "text-letter-spacing", min: -100, max: 500, hint: "Extra space between characters." },
    { key: "wordSpacing", label: "Word spacing", icon: "text-word-spacing", min: -100, max: 1000, hint: "Extra space between words." },
    { key: "paragraphSpacing", label: "Paragraph spacing", icon: "text-paragraph-spacing", min: 0, max: 2000, hint: "Extra space after an explicit line break." },
    { key: "baselineShift", label: "Baseline shift", icon: "text-baseline-shift", min: -1000, max: 1000, hint: "Positive values raise the text baseline." },
  ] as const;
  readonly contextMenu = signal<{ target: ContextTarget; x: number; y: number } | null>(null);
  readonly units = measurementUnits;
  readonly fontUnits = measurementUnits;
  readonly styleScopes = [
    { id: "fill", label: "Fill only", icon: "style-fill" },
    { id: "stroke", label: "Stroke only", icon: "style-stroke" },
    { id: "both", label: "Fill and stroke", icon: "style-both" },
  ] as const;
  get pageEdgeKeys() { return PAGE_EDGE_KEYS; }
  get registrationLabels() { return REGISTRATION_LABELS; }
  get dashPresets() { return DASH_PRESETS; }
  get dashFields() { return DASH_FIELDS; }
  dashPattern() { return this.paintStrokeStyle().dash ?? []; }
  dashPreset() {
    const dash = this.dashPattern();
    if (!dash.length) return "solid";
    return this.dashPresets.find((preset) => preset.id !== "custom" && preset.dash.length === dash.length && preset.dash.every((value, index) => value === dash[index]))?.id ?? "custom";
  }
  /** Preset values are shown as placeholders so empty fields read as the pattern they produce. */
  dashPlaceholder(index: number) {
    const preset = this.dashPresets.find((item) => item.id === this.dashPreset());
    return preset && preset.id !== "custom" ? (preset.dash[index] ?? "") : "";
  }
  setDashPreset(id: string) {
    const preset = this.dashPresets.find((item) => item.id === id);
    if (!preset) return;
    this.editor.setStrokeStyle({ dash: preset.id === "custom" ? (this.dashPattern().length ? this.dashPattern() : [12, 6]) : preset.dash });
  }
  setDashValue(index: number, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim(), value = Number(raw);
    const dash = [...this.dashPattern()];
    while (dash.length <= index) dash.push(0);
    if (raw === "") dash.splice(index);
    else if (Number.isFinite(value) && value >= 0 && value <= 1000) dash[index] = value;
    else return;
    this.editor.setStrokeStyle({ dash: dash.some((n, i) => i % 2 === 0 && n > 0) ? dash : [] });
  }
  readonly strokeControls = [
    { key: "alignment", label: "Stroke alignment", choices: [
      { value: "center", label: "Centered stroke", hint: "Place half the stroke on each side of the path.", icon: "stroke-center" },
      { value: "inside", label: "Inside stroke", hint: "Place the stroke inside closed outlines.", icon: "stroke-inside" },
      { value: "outside", label: "Outside stroke", hint: "Place the stroke outside closed outlines.", icon: "stroke-outside" },
    ] },
    { key: "join", label: "Corner joins", choices: [
      { value: "round", label: "Round join", hint: "Round the corner between stroke segments.", icon: "join-round" },
      { value: "bevel", label: "Bevel join", hint: "Cut off the outer corner with a straight edge.", icon: "join-bevel" },
      { value: "miter", label: "Miter join", hint: "Extend the edges to an angular corner. Very sharp corners use a bevel.", icon: "join-miter" },
    ] },
    { key: "cap", label: "Line caps", choices: [
      { value: "butt", label: "Butt cap", hint: "End the stroke exactly at its endpoint.", icon: "cap-butt" },
      { value: "square", label: "Projecting square cap", hint: "Extend a square cap half the stroke width beyond the endpoint.", icon: "cap-square" },
      { value: "round", label: "Round cap", hint: "Extend a semicircular cap beyond the endpoint.", icon: "cap-round" },
    ] },
  ] as const;
  readonly paintTargets = ["fill", "stroke"] as const;
  /** The brush lays down fill only, so its appearance block hides the stroke. */
  readonly fillOnly = ["fill"] as const;
  readonly quickColors = [{ value: "#000000", label: "Black" }, { value: "#ffffff", label: "White" }, { value: "none", label: "No color" }];
  readonly paintTarget = signal<"fill" | "stroke">("fill");
  readonly paintPicker = signal<{ x: number; y: number } | null>(null);
  readonly contextBlocks = [{ id: "tools", label: "Tools" }, { id: "appearance", label: "Appearance" }, { id: "workspace", label: "Workspace" }, { id: "measurement", label: "Measurement" }, { id: "dimensions", label: "Dimensions" }, { id: "pivot", label: "Pivot" }, { id: "selection", label: "Selection" }, { id: "swatches", label: "Swatches" }] as const;
  readonly colorModes: { id: ColorMode; label: string }[] = COLOR_MODES.map((id) => ({ id, label: { quick: "Quick RGB", rgb: "RGB", cmyk: "CMYK", grayscale: "Grayscale", palette: "Custom palette" }[id] }));
  readonly fillKinds = [{ id: "color", label: "Color" }, { id: "gradient", label: "Gradient" }, { id: "pattern", label: "Pattern" }, { id: "none", label: "None" }] as const;
  readonly presetPatterns = PRESET_PATTERNS.map((kind) => ({ kind, pattern: presetPattern(kind, "preview-" + kind) }));
  readonly swatchKinds = [{ id: "all", label: "All swatches" }, { id: "color", label: "Color swatches" }, { id: "gradient", label: "Gradient swatches" }, { id: "pattern", label: "Pattern swatches" }] as const;
  readonly swatchKind = signal<"all" | "color" | "gradient" | "pattern">("all");
  readonly rgbKeys = ["r", "g", "b"] as const;
  readonly cmykKeys = ["c", "m", "y", "k"] as const;
  readonly swatchTarget = signal<"fill" | "stroke">("fill");
  readonly chosenSwatch = signal<string | null>(null);
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
      families: ["pen", "pencil", "shape", "line", "text", "scissors", "dimensions", "architecture"],
    },
    {
      id: "paint",
      label: "Painting and symbols",
      families: ["paint", "eraser", "style", "symbols"],
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
  /** The clipboard beside the import action, since both bring artwork into the document. */
  readonly clipboardGroup = {
    id: "clipboard",
    label: "Copy and paste",
    icon: "copy",
    commands: ["copy", "cut", "paste", "pasteInFront", "pasteInBack", "duplicate", "duplicateSeries", "transformAgain"],
  };
  readonly actionGroups = [
    {
      id: "objectBlend",
      label: "Blend objects",
      icon: "object-blend",
      commands: ["makeBlend", "expandBlend", "releaseBlend"],
    },
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
      id: "document",
      label: "Document dimensions",
      icon: "document",
      commands: ["documentFormat", "expandDocument", "cropDocument"],
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
  readonly settingsCategories = [
    { id: "cursor", label: "Cursor", icon: "select" },
    { id: "selection", label: "Selection and transforms", icon: "direct" },
    { id: "anchors", label: "Selection and anchor display", icon: "addAnchor" },
    { id: "measurement", label: "Units and snapping", icon: "rulers" },
    { id: "appearance", label: "Appearance", icon: "theme" },
    { id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard" },
  ] as const;
  readonly settingsCategory = signal<"cursor" | "selection" | "anchors" | "measurement" | "appearance" | "shortcuts">("cursor");
  /** The commands of Object > Path, and those the path panel offers, in Illustrator's order. */
  readonly pathMenuCommands = ["joinPaths", "averageAnchors", "simplifyPath", "outlineStroke", "selectStray"] as const;
  /** Object > Lock and Object > Hide, with their companions, in the order Illustrator gives them. */
  readonly lockMenuCommands = ["lockSelection", "lockAbove", "lockOthers", "unlockAll"] as const;
  /** Object > Transform, in the order Illustrator gives it. */
  readonly transformMenuCommands = ["transformAgain", "displacement", "rotation", "scaleDialog", "shearDialog", "transformEach"] as const;
  readonly hideMenuCommands = ["hideSelection", "hideAbove", "hideOthers", "showAll"] as const;
  readonly pathPanelCommands = ["convertCorner", "convertSmooth", "removeAnchors", "joinPaths", "cutAtAnchors", "averageAnchors", "simplifyPath"] as const;
  readonly averageAxes = [
    { id: "horizontal", label: "Horizontal" },
    { id: "vertical", label: "Vertical" },
    { id: "both", label: "Both" },
  ] as const;
  readonly commandList = COMMANDS;
  readonly recording = signal<string | null>(null);
  readonly toolGroup = signal("Draw");
  readonly cursorPoint = signal<{ x: number; y: number } | null>(null);
  readonly temporaryPan = signal(false);
  readonly temporarySelect = signal(false);
  /** Alt changes what several path tools do, and the icon beside the cursor says so. */
  readonly altHeld = signal(false);
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
  readonly spatialParallax = signal(false);
  readonly dialog = signal(false);
  readonly projects = signal<{ id: string; name: string; updatedAt: string }[]>(
    [],
  );
  readonly apiToken = signal("");
  readonly releases = signal<Release[]>([]);
  /** Year of the copyright line in the footer. */
  readonly year = new Date().getFullYear();
  readonly currentVersion = signal("…");
  readonly chosenVersion = signal("");
  readonly noteGroups = signal<{ title: string; items: string[] }[]>([]);
  readonly aboutError = signal("");
  readonly panelOrder = signal(["properties", "layers"]);
  private frame = 0;
  private pan?: { x: number; y: number; left: number; top: number };
  private spatialView?: SpatialPreview;
  constructor(
    readonly editor: EditorService,
    readonly preferences: PreferencesService,
  ) {
    effect(() => {
      const config: SnapConfig = {
        zoom: editor.zoom(),
        rulers: { enabled: preferences.snapRulers(), visible: preferences.rulersVisible(), step: preferences.rulerStep(), radius: preferences.rulerSnapRadius(), minorStep: preferences.rulerMinorStep(), majorEnabled: preferences.snapRulerMajor(), minorEnabled: preferences.snapRulerMinor() },
        grid: { enabled: preferences.snapGrid(), visible: preferences.gridVisible(), step: preferences.gridSize(), radius: preferences.gridSnapRadius() },
        guides: { enabled: preferences.snapGuides(), visible: preferences.guidesVisible(), radius: preferences.guideSnapRadius(), items: editor.document().layers.filter(layer => layer.guide && layer.visible && layer.id !== this.draggingGuideId()).map(layer => ({ axis: layer.guide === "vertical" ? "x" as const : "y" as const, position: layer.guide === "vertical" ? layer.x : layer.y })) },
      };
      editor.snapConfig.set(config);
    });
    effect(() => { editor.lastAreaSelection.set(preferences.lastAreaSelection()); });
    effect(() => { editor.dimensionsVisible.set(preferences.dimensionsVisible()); editor.setDimensionsLocked(preferences.dimensionsLocked()); editor.dimensionsSnap.set(preferences.dimensionsSnap()); editor.dimensionSnapRadius.set(preferences.dimensionSnapRadius()); editor.pivotVisible.set(preferences.pivotVisible()); editor.pivotLocked.set(preferences.pivotLocked()); editor.pivotSnap.set(preferences.pivotSnap()); editor.areaSelectionMode.set(preferences.areaSelectionMode()); this.schedule(); });
    effect(() => { editor.setGuidesLocked(preferences.guidesLocked()); });
    effect(() => {
      editor.snapAngle.set(preferences.snapAngle());
    });
    effect(() => {
      // The path settings the preferences keep drive the tools and the anchor display.
      const settings = preferences.pathSettings();
      editor.pencilOptions.set(settings.pencil);
      editor.paintbrushOptions.set(settings.paintbrush);
      editor.smoothOptions.set(settings.smooth);
      editor.activeBrushStroke.set(settings.brush);
      editor.autoAddDelete.set(settings.autoAddDelete);
      editor.anchorDisplay.set(settings.anchorDisplay);
      editor.handleStyle.set(settings.handleStyle);
      editor.showHandlesMultiple.set(settings.showHandlesMultiple);
      editor.highlightAnchors.set(settings.highlightAnchors);
      editor.eraserShape.set(settings.eraser);
    });
    effect(() => {
      editor.document();
      editor.selectedId();
      editor.selectedIds();
      editor.revision();
      editor.areaSelection();
      editor.dimensionDraft();
      editor.dimensionSnapTarget();
      editor.zoom();
      editor.tool();
      this.temporarySelect();
      editor.showHandles();
      editor.boundingBoxVisible();
      editor.outlineView();
      editor.handleSize();
      editor.activeNodes();
      editor.activeSegments();
      editor.otherAnchors();
      editor.hoverAnchor();
      editor.anchorDisplay();
      editor.handleStyle();
      editor.showHandlesMultiple();
      editor.highlightAnchors();
      editor.reshapeFocal();
      editor.penId();
      this.textEditing();
      this.textDraft();
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
      copy: { label: "Copy", section: "clipboard", command: "copy" },
      cut: { label: "Cut", section: "clipboard", command: "cut" },
      paste: { label: "Paste", section: "clipboard", command: "paste" },
      pasteInFront: { label: "Paste in front", section: "clipboard", command: "pasteInFront" },
      pasteInBack: { label: "Paste in back", section: "clipboard", command: "pasteInBack" },
      duplicate: { label: "Duplicate", section: "clipboard", command: "duplicate" },
      duplicateSeries: { label: "Duplicate in series", section: "clipboard", command: "duplicateSeries" },
      toggleBoundingBox: { label: "Show or hide the bounding box", section: "view", command: "toggleBoundingBox" },
      displacement: { label: "Enter displacement", section: "transform", command: "displacement" },
      rotation: { label: "Enter rotation", section: "transform", command: "rotation" },
      group: { label: "Group", section: "group", command: "group" },
      ungroup: { label: "Ungroup", section: "group", command: "ungroup" },
      regroup: { label: "Regroup", section: "group", command: "regroup" },
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
    if (context && enabled && action === "duplicateSeries") { this.openArrayDialog(); return; }
    if (context && enabled && (action === "displacement" || action === "rotation")) { this.openTransformDialog(action); return; }
    if (context && enabled) this.editor.runContextAction(context.target, action as ContextAction);
  }
  dismissContext() { this.contextMenu?.set(null); }
  typography(layer: Layer): TextTypography { return { ...defaultTypography, ...layer.typography }; }
  textLayout(layer: Layer): TextLayoutOptions { return { ...defaultTextLayout, ...layer.textLayout }; }
  setTextSizing(mode: TextLayoutOptions["sizing"]) {
    const layer = this.editor.selected();
    if (layer && (layer.kind === "text" || layer.dimension)) this.editor.updateTextLayout({ sizing: this.textLayout(layer).sizing === mode ? "fixed" : mode });
  }
  toggleTextOption(key: "wrap" | "hyphenate" | "fit") {
    const layer = this.editor.selected();
    if (!layer || (layer.kind !== "text" && !layer.dimension)) return;
    const layout = this.textLayout(layer), enabled = !layout[key];
    this.editor.updateTextLayout(key === "wrap" && enabled && ["width", "content"].includes(layout.sizing) ? { wrap: true, sizing: "fixed" } : { [key]: enabled });
  }
  setTypographyNumber(key: "lineHeight" | "letterSpacing" | "wordSpacing" | "paragraphSpacing" | "baselineShift", event: Event) {
    const value = this.number(event), field = this.typographyFields.find(field => field.key === key)!;
    if (Number.isFinite(value)) this.editor.updateTypography({ [key]: Math.max(field.min, Math.min(field.max, toPixels(value, this.preferences.fontUnit()))) });
  }
  setTextScale(key: "horizontalScale" | "verticalScale", event: Event) {
    const value = this.number(event);
    if (Number.isFinite(value)) this.editor.updateTypography({ [key]: Math.max(.1, Math.min(10, value / 100)) });
  }
  toggleTextStyle(key: "fontStyle" | "decoration", value: "italic" | "underline" | "line-through") {
    const layer = this.editor.selected();
    if (!layer || (layer.kind !== "text" && !layer.dimension)) return;
    const current = this.typography(layer);
    if (key === "fontStyle") this.editor.updateTypography({ fontStyle: current.fontStyle === "italic" ? "normal" : "italic" });
    else this.editor.updateTypography({ decoration: current.decoration === value ? "none" : value as "underline" | "line-through" });
  }
  inlineLayer() {
    const layer = this.editor.document().layers.find(layer => layer.id === this.textEditing());
    return layer ? this.editor.previewText(layer, this.textDraft()) : null;
  }
  inlineMetrics(layer: Layer) { return this.editor.textMetrics(layer); }
  usesStyleDefaults() { return ["eyedropper", "paintBucket"].includes(this.editor.tool()); }
  proceduralTool(): ProceduralKind | null { const tool = this.editor.tool(); return ["wall", "door", "window", "pillar", "stair"].includes(tool) ? tool as ProceduralKind : null; }
  proceduralProperties(): Procedural | undefined { const tool = this.proceduralTool(); return tool ? this.editor.proceduralDefaults()[tool] : this.editor.selected()?.procedural; }
  patchProcedural(patch: Record<string, unknown>) {
    const tool = this.proceduralTool();
    const applied = tool ? this.editor.updateProceduralDefaults(tool, patch) : this.editor.updateProcedural(patch);
    if (applied === false) this.notify(new Error("The floor plan parameters cannot be applied."));
  }
  setProceduralNumber(key: "width" | "depth" | "thickness" | "length" | "openingAngle", event: Event) {
    const p = this.proceduralProperties(); if (!p) return;
    const value = key === "openingAngle" ? this.number(event) : this.distanceInput(event);
    if (!Number.isFinite(value) || value < (key === "openingAngle" ? 0 : 1) || value > (key === "openingAngle" ? 180 : 16384)) return;
    const patch: Record<string, unknown> = { [key]: value };
    if (key === "width" && (p.type === "door" || p.type === "window")) patch['leafWidths'] = p.leafWidths.map(width => width * value / p.width);
    if (p.type === "pillar" && p.shape === "circle" && (key === "width" || key === "depth")) { patch['width'] = value; patch['depth'] = value; }
    this.patchProcedural(patch);
  }
  get leafTypeLabels() { return LEAF_TYPE_LABELS; }
  doorOperations = ["swing", "sliding", "folding", "pocket", "opening"];
  windowOperations = ["fixed", "swing", "sliding", "opening"];
  leafTypeChoices(type: "door" | "window") {
    return (type === "door" ? this.doorOperations : this.windowOperations).filter((operation) => operation !== "opening");
  }
  /** Per-leaf mechanism; an unset leaf follows the opening mechanism. */
  leafType(index: number) {
    const p = this.proceduralProperties();
    return p?.type === "door" || p?.type === "window" ? (p.leafTypes?.[index] ?? p.operation) : "";
  }
  setLeafType(index: number, event: Event) {
    const p = this.proceduralProperties();
    if (p?.type !== "door" && p?.type !== "window") return;
    const value = this.text(event);
    if (!(LEAF_TYPES as string[]).includes(value)) return;
    const leafTypes = p.leafWidths.map((_, position) => (position === index ? value : (p.leafTypes?.[position] ?? (p.operation === "opening" ? "fixed" : p.operation)))) as LeafType[];
    this.patchProcedural({ leafTypes: leafTypes.every((leaf) => leaf === leafTypes[0]) && leafTypes[0] === p.operation ? undefined : leafTypes });
  }
  setProceduralSteps(event: Event) {
    const steps = Math.round(this.number(event));
    if (Number.isFinite(steps) && steps >= 2 && steps <= 100) this.patchProcedural({ steps });
  }
  setProceduralLeafCount(event: Event) {
    const p = this.proceduralProperties(); if (!p || (p.type !== "door" && p.type !== "window")) return;
    const count = this.number(event); if (!Number.isInteger(count) || count < 1 || count > (p.type === "door" ? 4 : 8)) return;
    const previous = p.type === "door" || p.type === "window" ? p.leafTypes : undefined;
    this.patchProcedural({ leafWidths: Array.from({length: count}, () => p.width / count), ...(previous ? { leafTypes: Array.from({length: count}, (_, index) => previous[index] ?? previous[previous.length - 1]) } : {}) });
  }
  setProceduralLeafWidth(index: number, event: Event) {
    const p = this.proceduralProperties(); if (!p || (p.type !== "door" && p.type !== "window")) return;
    const width = this.distanceInput(event); if (!Number.isFinite(width) || width < 1 || width > 16384) return;
    const leafWidths = p.leafWidths.map((value, i) => i === index ? width : value);
    const total = leafWidths.reduce((a, b) => a + b, 0); if (total > 16384) return;
    this.patchProcedural({ leafWidths, width: total });
  }
  setPillarShape(event: Event) { const p = this.proceduralProperties(); if (p?.type !== "pillar") return; const shape = this.text(event); if (shape === "rectangle" || shape === "circle") this.patchProcedural({shape, ...(shape === "circle" ? {depth: p.width} : {})}); }
  proceduralHint() { const tool = this.proceduralTool(); return tool === "wall" ? "Click to continue the wall run; press Escape to end it." : tool === "pillar" ? "Drag to size the pillar footprint." : tool === "stair" ? "Drag to size the flight; the arrow follows the walking direction." : "Click near a wall to attach the opening, or click empty space for free placement."; }
  /** Page setup: format, rulers, margins, background, registration marks, expand and crop. */
  readonly pageDialog = signal<"format" | "expand" | "crop" | null>(null);
  get pageCategories(): { id: PageCategory; label: string }[] { return PAGE_CATEGORIES; }
  get pageResolutions() { return PAGE_RESOLUTIONS; }
  get registrationOptions() { return REGISTRATION_MARKS; }
  readonly pageCategory = signal<PageCategory>("paper");
  readonly pageFormatId = signal("a4");
  readonly pageResolution = signal(96);
  readonly pageOrientation = signal<PageOrientation>("portrait");
  readonly pageMargins = signal<MarginGuides>({ ...defaultMarginGuides });
  readonly pageMarks = signal<RegistrationMarks>("none");
  readonly pageBackground = signal("#ffffff");
  readonly pageEdges = signal({ top: 0, right: 0, bottom: 0, left: 0 });
  pageFormats() { return PAGE_FORMATS.filter((format) => format.category === this.pageCategory()); }
  pageFormat() { return PAGE_FORMATS.find((format) => format.id === this.pageFormatId()) ?? PAGE_FORMATS[0]; }
  pagePixels() { return pageSize(this.pageFormat(), this.pageResolution(), this.pageOrientation()); }
  pageFits() { return pageSizeFits(this.pagePixels()); }
  pageMarksFit() { return this.pageMarks() === "none" || registrationFits(this.pageMarks(), this.pagePixels()); }
  /** Guide distances are shown in the unit the rulers use. */
  marginDistance(value: number) { return this.displayDistance(value); }
  /** Page editing on the canvas: drag the corner handles to resize, or drag an area to crop. */
  startPageEditing(mode: "resize" | "crop") {
    this.dismissMenus();
    this.editor.setPageMode(mode);
  }
  openPageDialog(mode: "format" | "expand" | "crop") {
    this.dismissMenus();
    const document = this.editor.document();
    this.pageBackground.set(document.background);
    this.pageEdges.set({ top: 0, right: 0, bottom: 0, left: 0 });
    const match = PAGE_FORMATS.find((format) => { const size = pageSize(format, this.pageResolution(), this.pageOrientation()); return size.width === document.width && size.height === document.height; });
    if (match) { this.pageCategory.set(match.category); this.pageFormatId.set(match.id); }
    this.pageDialog.set(mode);
  }
  setPageCategory(event: Event) {
    const value = this.text(event) as PageCategory;
    if (!PAGE_CATEGORIES.some((category) => category.id === value)) return;
    this.pageCategory.set(value);
    this.pageFormatId.set(this.pageFormats()[0].id);
  }
  // Document properties, shown in Properties when nothing is selected. Each change is
  // applied at once and keeps the rest of the page setup as it was.
  activeTabName() { return this.editor.tabs().find((tab) => tab.active)?.name ?? ""; }
  edgeLabel(edge: "top" | "right" | "bottom" | "left") { return edge === "top" ? "Top" : edge === "right" ? "Right" : edge === "bottom" ? "Bottom" : "Left"; }
  edgeInitial(edge: "top" | "right" | "bottom" | "left") { return this.t(this.edgeLabel(edge)).slice(0, 1).toUpperCase(); }
  setDocumentSize(key: "width" | "height", event: Event) {
    const value = this.distanceInput(event);
    if (!Number.isFinite(value) || value <= 0) return;
    if (this.editor.updatePageSetup({ [key]: value })) this.fit();
  }
  setDocumentOrientation(orientation: "portrait" | "landscape") {
    const { width, height } = this.editor.document();
    if (width === height || (orientation === "portrait") === height > width) return;
    if (this.editor.updatePageSetup({ width: height, height: width })) this.fit();
  }
  setDocumentMargin(edge: "top" | "right" | "bottom" | "left", event: Event) {
    const value = this.distanceInput(event);
    if (!Number.isFinite(value) || value < 0) return;
    // A margin typed in is a margin wanted, so its guides are shown.
    const margins = { ...this.editor.pageSetup().margins, [edge]: value, edges: true };
    this.editor.updatePageSetup({ margins });
  }
  toggleDocumentMargin(key: "edges" | "centerX" | "centerY", enabled: boolean) {
    this.editor.updatePageSetup({ margins: { ...this.editor.pageSetup().margins, [key]: enabled } });
  }
  setDocumentMarks(event: Event) {
    const marks = this.text(event) as RegistrationMarks;
    if (!REGISTRATION_MARKS.includes(marks)) return;
    this.editor.updatePageSetup({ marks });
  }
  setPageMargin(key: "top" | "right" | "bottom" | "left", event: Event) {
    const value = this.distanceInput(event);
    if (!Number.isFinite(value) || value < 0 || value > 2048) return;
    this.pageMargins.update((margins) => ({ ...margins, [key]: value }));
  }
  togglePageMargin(key: "edges" | "centerX" | "centerY", enabled: boolean) {
    this.pageMargins.update((margins) => ({ ...margins, [key]: enabled }));
  }
  setPageEdge(key: "top" | "right" | "bottom" | "left", event: Event) {
    const value = this.distanceInput(event);
    if (!Number.isFinite(value) || value < 0 || value > 8192) return;
    this.pageEdges.update((edges) => ({ ...edges, [key]: value }));
  }
  applyPageDialog() {
    const mode = this.pageDialog();
    const applied = mode === "format"
      ? this.editor.applyPageSetup({ size: this.pagePixels(), background: this.pageBackground(), margins: this.pageMargins(), marks: this.pageMarks() })
      : mode === "expand" ? this.editor.expandPage(this.pageEdges()) : this.editor.cropPage(this.pageEdges());
    if (applied) { this.pageDialog.set(null); this.fit(); }
  }
  readonly transformDialog = signal<"displacement" | "rotation" | null>(null);
  /** The Scale, Shear and Transform Each dialogs of Object > Transform, and their values. */
  readonly affineDialog = signal<"scale" | "shear" | "each" | null>(null);
  readonly referencePoints = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
  affineDraft = { uniform: true, scale: 100, horizontal: 100, vertical: 100, scaleStrokes: false, angle: 0, axis: "horizontal" as "horizontal" | "vertical" | "angle", axisAngle: 0,
    moveX: 0, moveY: 0, rotation: 0, reflectX: false, reflectY: false, reference: "center" };
  openAffineDialog(kind: "scale" | "shear" | "each") {
    if (!this.editor.selectedLayers().some((layer) => !layer.guide)) { this.editor.status.set("Select the objects to transform."); return; }
    this.flyout.set(null);
    this.affineDraft = { ...this.affineDraft, scaleStrokes: this.editor.scaleStrokes(), moveX: 0, moveY: 0 };
    this.affineDialog.set(kind);
    setTimeout(() => window.document.querySelector<HTMLInputElement>(".affine-dialog input[type=number]")?.focus());
  }
  /** OK or Copy in the Scale, Shear or Transform Each dialog. */
  applyAffineDialog(copy: boolean) {
    const d = this.affineDraft, kind = this.affineDialog();
    this.editor.setScaleStrokes(d.scaleStrokes);
    const unit = this.preferences.distanceUnit();
    const applied = kind === "scale"
      ? this.editor.scaleSelection(d.uniform ? d.scale : d.horizontal, d.uniform ? d.scale : d.vertical, { copy, scaleStrokes: d.scaleStrokes })
      : kind === "shear"
        ? this.editor.shearSelection(d.angle, d.axis === "horizontal" ? 0 : d.axis === "vertical" ? 90 : d.axisAngle, { copy })
        : this.editor.transformEach({ scaleX: d.horizontal, scaleY: d.vertical, moveX: toPixels(d.moveX, unit), moveY: toPixels(d.moveY, unit), rotation: d.rotation,
            reflectX: d.reflectX, reflectY: d.reflectY, reference: d.reference, copy, scaleStrokes: d.scaleStrokes });
    if (applied) this.affineDialog.set(null);
    else this.notify(new Error("The transformation cannot be applied to this selection."));
  }
  /** Object > Envelope Distort, in the order Illustrator gives it. */
  readonly envelopeMenuCommands = ["envelopeWarp", "envelopeMesh", "envelopeTop", "envelopeRelease", "envelopeOptions", "envelopeExpand", "envelopeEdit", "envelopeResetWarp", "envelopeResetMesh"] as const;
  readonly warpStyles = WARP_STYLES.map((id) => ({ id, label: WARP_LABELS[id] }));
  /** The envelope dialogs: Warp Options to make or reset, the mesh size to make or reset, and Envelope Options. */
  readonly envelopeDialog = signal<"warp" | "resetWarp" | "mesh" | "resetMesh" | "options" | null>(null);
  warpDraft: WarpSettings = { ...DEFAULT_WARP };
  warpPreview = true;
  meshDraft = { rows: 4, columns: 4, maintainShape: true };
  fidelityDraft = 50;
  openEnvelopeDialog(kind: "warp" | "resetWarp" | "mesh" | "resetMesh" | "options") {
    const envelope = this.editor.selectedEnvelope()?.envelope;
    if (kind === "resetWarp" && envelope?.warp) this.warpDraft = { ...envelope.warp };
    if (kind === "resetMesh" && envelope) this.meshDraft = { rows: envelope.mesh.rows, columns: envelope.mesh.columns, maintainShape: true };
    if (kind === "options" && envelope) this.fidelityDraft = envelope.fidelity;
    this.envelopeDialog.set(kind);
    if (kind === "warp" && this.warpPreview) this.previewWarp();
  }
  /** Shows the warp on the canvas while the dialog is open, as Preview does in Illustrator. */
  previewWarp() {
    if (this.envelopeDialog() !== "warp") return;
    if (this.warpPreview) this.editor.makeEnvelope("warp", { warp: { ...this.warpDraft } }, true);
    else this.editor.cancelEnvelopePreview();
  }
  setWarp<K extends keyof WarpSettings>(key: K, value: WarpSettings[K]) {
    this.warpDraft = { ...this.warpDraft, [key]: value };
    this.previewWarp();
  }
  setWarpNumber(key: "bend" | "horizontal" | "vertical", event: Event) {
    const value = Math.round(this.number(event));
    if (Number.isFinite(value) && value >= -100 && value <= 100) this.setWarp(key, value);
  }
  applyEnvelopeDialog() {
    const kind = this.envelopeDialog(), d = this.meshDraft;
    const done = kind === "warp" ? this.editor.makeEnvelope("warp", { warp: { ...this.warpDraft } })
      : kind === "resetWarp" ? this.editor.resetEnvelopeWithWarp({ ...this.warpDraft })
        : kind === "mesh" ? this.editor.makeEnvelope("mesh", { rows: Math.round(d.rows), columns: Math.round(d.columns) })
          : kind === "resetMesh" ? this.editor.resetEnvelopeWithMesh(Math.round(d.rows), Math.round(d.columns), d.maintainShape)
            : this.editor.setEnvelopeFidelity(this.fidelityDraft);
    if (done) this.envelopeDialog.set(null);
    else this.notify(new Error(this.editor.status() || "The envelope cannot be changed that way."));
  }
  cancelEnvelopeDialog() { this.editor.cancelEnvelopePreview(); this.envelopeDialog.set(null); }
  /** The options dialog of a liquify tool, opened by double-clicking it, and its values. */
  readonly liquifyDialog = signal<LiquifyTool | null>(null);
  liquifyDraft: LiquifyOptions = { ...LIQUIFY_DEFAULTS.warp };
  openLiquifyOptions(tool: LiquifyTool) {
    this.flyout.set(null);
    this.liquifyDraft = { ...this.editor.liquifyOptions()[tool] };
    this.liquifyDialog.set(tool);
  }
  applyLiquifyOptions() {
    const tool = this.liquifyDialog();
    if (tool && this.editor.setLiquifyOptions(tool, { ...this.liquifyDraft })) this.liquifyDialog.set(null);
    else this.notify(new Error("Keep every option inside its range."));
  }
  resetLiquifyOptions() { const tool = this.liquifyDialog(); if (tool) this.liquifyDraft = { ...LIQUIFY_DEFAULTS[tool] }; }
  /** The brush of the liquify tool in use, in screen pixels, drawn at the cursor. */
  liquifyBrush(): { width: number; height: number; angle: number } | null {
    const tool = this.activeTool();
    if (!this.editor.isLiquifyTool(tool)) return null;
    const o = this.editor.liquifyOptions()[tool], zoom = this.editor.zoom();
    return { width: o.width * zoom, height: o.height * zoom, angle: o.angle };
  }
  /** While the button is held, Twirl, Pucker, Bloat and the detail tools keep acting in place. */
  private liquifyTimer?: ReturnType<typeof setInterval>;
  private stopLiquifyTimer() { if (this.liquifyTimer) { clearInterval(this.liquifyTimer); this.liquifyTimer = undefined; } }
  /** An Alt-click with the Scale or Shear tool sets the reference point and opens its dialog. */
  private altClick?: { tool: "scale" | "shear"; x: number; y: number };
  transformX = 0; transformY = 0; numericAngle = 0; transformCenterX = 0; transformCenterY = 0;
  openTransformDialog(kind: "displacement" | "rotation") {
    if (!this.editor.selectedLayers().length) return;
    const center = this.editor.transformationCenter();
    this.transformX = 0; this.transformY = 0; this.numericAngle = 0;
    this.transformCenterX = this.displayDistance(center.x); this.transformCenterY = this.displayDistance(center.y);
    this.transformDialog.set(kind);
    setTimeout(() => window.document.querySelector<HTMLInputElement>(".transform-dialog input")?.focus());
  }
  applyNumericTransform() {
    const unit = this.preferences.distanceUnit();
    const applied = this.transformDialog() === "displacement" ? this.editor.displaceSelection(toPixels(this.transformX, unit), toPixels(this.transformY, unit)) : this.editor.rotateSelection(this.numericAngle, { x: toPixels(this.transformCenterX, unit), y: toPixels(this.transformCenterY, unit) });
    if (applied) this.transformDialog.set(null);
    else this.notify(new Error("The transformation cannot be applied to this selection."));
  }
  commandIcon(id: string) { return COMMAND_ICONS[id] ?? ""; }
  setDimensionPlacement(event: Event) {
    const value = this.text(event);
    if (["start", "center", "end"].includes(value)) this.editor.updateDimension({ labelPlacement: value as "start" | "center" | "end" });
  }
  setDimensionLabelSize(key: "width" | "height", event: Event) {
    const layer = this.editor.selected(); if (!layer?.dimension) return;
    const value = this.distanceInput(event); if (!Number.isFinite(value) || value < 1 || value > 1000000) return;
    this.editor.updateDimension({labelSize: { width: layer.dimension.labelSize?.width ?? layer.width, height: layer.dimension.labelSize?.height ?? layer.height, [key]: value }});
  }
  readonly lineEndSides = ["start", "end"] as const;
  readonly lineEndKinds = ["none", "arrow", "openArrow", "triangle", "dot", "slash", "cross"] as const;
  readonly lineEndLabels = { none: "No ending", arrow: "Arrow", openArrow: "Open arrow", triangle: "Triangle", dot: "Round dot", slash: "Diagonal tick", cross: "Cross" };
  paintLineEnds(): LineEnds { const layer = this.editor.selected(); return !this.usesStyleDefaults() && layer ? layer.lineEnds ?? defaultLineEnds : this.editor.lineEnds(); }
  setLineEnd(side: "start" | "end", patch: Partial<LineEnd>) { this.editor.setLineEnds({ [side]: { ...this.paintLineEnds()[side], ...patch } }); }
  setLineEndSize(side: "start" | "end", event: Event) { const size = this.distanceInput(event); if (Number.isFinite(size) && size > 0 && size <= 1000) this.setLineEnd(side, { size }); }
  setDimensionFormat(key: keyof DimensionFormat, event: Event) {
    const dimension = this.editor.selected()?.dimension; if (!dimension) return;
    const value = key === "unit" || key === "separator" ? this.text(event) : this.number(event);
    this.editor.updateDimension({ format: { ...dimension.format, [key]: value } });
  }
  /** Hexadecimal value for a colour input; absent paint falls back to black without changing the stored value. */
  /** Page background swatches: print black and white, blueprint blue, chroma key green and no colour. */
  get backgroundSwatches() { return BACKGROUND_SWATCHES; }
  backgroundPaint() { return this.editor.document().background; }
  backgroundBase() { return this.colorValue(this.backgroundPaint()); }
  backgroundOpacity() {
    const paint = this.backgroundPaint();
    return paint === "none" ? 0 : paint.length === 9 ? Math.round((parseInt(paint.slice(7), 16) / 255) * 100) : 100;
  }
  setBackgroundPaint(paint: string) { this.editor.background(paint); }
  setBackgroundBase(color: string) {
    const paint = this.backgroundPaint();
    this.editor.background(color + (paint.length === 9 ? paint.slice(7) : ""));
  }
  setBackgroundOpacity(opacity: number) {
    if (!Number.isFinite(opacity)) return;
    const alpha = Math.round((Math.max(0, Math.min(100, opacity)) / 100) * 255).toString(16).padStart(2, "0");
    this.editor.background(alpha === "00" ? "none" : this.backgroundBase() + (alpha === "ff" ? "" : alpha));
  }
  // Brush and eraser controls shown in the top bar while either tool is active.
  get brushTypes() { return BRUSH_TYPES; }
  get brushTypeLabels() { return BRUSH_TYPE_LABELS; }
  paintingTool(): "brush" | "eraser" | null {
    const tool = this.editor.tool();
    return tool === "brush" || tool === "eraser" ? tool : null;
  }
  brush(): BrushSettings { return this.editor.brushFor(this.paintingTool() ?? "brush"); }
  setBrush(patch: Partial<BrushSettings>) {
    const tool = this.paintingTool();
    if (tool && !this.editor.updateBrush(tool, patch)) this.notify(new Error("The brush settings cannot be applied."));
  }
  setBrushNumber(key: "pressure" | "opacity" | "cadence" | "diffusion" | "angle" | "speedVariation", event: Event) {
    const value = this.number(event);
    if (Number.isFinite(value)) this.setBrush({ [key]: value });
  }
  /** Sample stroke drawn with the current settings, so the choice is visible before painting. */
  brushPreviewPath() {
    const settings = this.brush(), points = previewStroke(140, 34);
    const size = Math.max(2, Math.min(18, this.editor.size()));
    let path = "";
    for (let index = 1; index < points.length; index++) {
      // A gesture that starts slowly, speeds up in the middle and eases out, so the slider shows its effect.
      const progress = index / points.length;
      const speed = size * 4 * Math.sin(Math.PI * progress);
      for (const stamp of brushStamps(points[index - 1], points[index], size, settings, speed)) {
        const rx = stamp.radiusX.toFixed(2), ry = stamp.radiusY.toFixed(2);
        path += `M${(stamp.center.x - stamp.radiusX).toFixed(2)},${stamp.center.y.toFixed(2)}a${rx},${ry} ${((stamp.angle * 180) / Math.PI).toFixed(1)} 1 0 ${(stamp.radiusX * 2).toFixed(2)},0a${rx},${ry} ${((stamp.angle * 180) / Math.PI).toFixed(1)} 1 0 ${(-stamp.radiusX * 2).toFixed(2)},0`;
      }
    }
    return path;
  }
  brushPreviewPaint() { return this.paintingTool() === "eraser" ? "var(--muted)" : this.editor.fill(); }
  colorValue(paint: string) { return /^#[0-9a-fA-F]{6}/.test(paint) ? paint.slice(0, 7) : "#000000"; }
  setDimensionExtensionColor(event: Event) {
    const dimension = this.editor.selected()?.dimension; if (!dimension) return;
    const alpha = /^#[0-9a-fA-F]{8}$/.test(dimension.extension.stroke) ? dimension.extension.stroke.slice(7) : "";
    this.editor.updateDimension({ extension: { ...dimension.extension, stroke: this.text(event) + alpha } });
  }
  setDimensionExtension(key: "stroke" | "strokeWidth" | "gap" | "overshoot", event: Event) {
    const dimension = this.editor.selected()?.dimension; if (!dimension) return;
    this.editor.updateDimension({ extension: { ...dimension.extension, [key]: key === "stroke" ? this.text(event) : this.distanceInput(event) } });
  }
  setLabelText(event: Event) { if (this.editor.selected()?.dimension) this.editor.updateDimension({ text: this.text(event) }); else this.editor.updateLayer({ text: this.text(event) }); }
  dimensionLabelPosition(layer: Layer) { return dimensionGeometry(layer).labelPosition; }
  dimensionDraftPath() { const draft = this.editor.dimensionDraft(); return draft && !this.editor.dimensionPreview() ? [...draft.points, draft.cursor].map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") : ""; }
  /** Screen overlay for the annotation being placed: the same geometry as the committed Canvas/SVG output. */
  dimensionPreviewShape() {
    const layer = this.editor.dimensionPreview();
    if (!layer) return null;
    const g = dimensionGeometry(layer, (text, size, type) => this.editor.renderer.measureText(text, size, type));
    const lines = g.lines.map((l) => `M${l.a.x},${l.a.y}L${l.b.x},${l.b.y}`).join("");
    const arc = g.arc ? (() => { const a = g.arc!, s = { x: a.center.x + a.radius * Math.cos(a.startAngle), y: a.center.y + a.radius * Math.sin(a.startAngle) }, e = { x: a.center.x + a.radius * Math.cos(a.endAngle), y: a.center.y + a.radius * Math.sin(a.endAngle) }; return `M${s.x},${s.y}A${a.radius},${a.radius} 0 0 ${a.endAngle > a.startAngle ? 1 : 0} ${e.x},${e.y}`; })() : "";
    const heads = g.ends.map((end) => lineEndGeometry(end.point, end.direction, end.style, end.spread).points.map((p) => `${p.x},${p.y}`).join(" "));
    return { path: lines + arc, heads, text: g.text, fontSize: layer.fontSize, transform: `translate(${g.labelPosition.x} ${g.labelPosition.y}) rotate(${(g.labelAngle * 180) / Math.PI})` };
  }
  paintStrokeStyle(): StrokeStyle {
    const layer = this.editor.selected();
    return !this.usesStyleDefaults() && layer && !layer.guide && layer.kind !== "image" ? { ...defaultStrokeStyle, ...layer.strokeStyle } : this.editor.strokeStyle();
  }
  strokeAlignmentAvailable() {
    if (this.usesStyleDefaults()) return true;
    const layers = this.editor.selectedLayers().filter(layer => !layer.guide && !layer.locked);
    return !layers.length || layers.some(layer => layer.kind === "rectangle" || layer.kind === "ellipse" || layer.curves?.some(path => path.closed));
  }
  setStrokeOption(key: keyof StrokeStyle, value: string) {
    if (key === "alignment") {
      if (!["center", "inside", "outside"].includes(value) || (value !== "center" && !this.strokeAlignmentAvailable())) return;
      this.editor.setStrokeStyle({ alignment: value as StrokeStyle["alignment"] });
    } else if (key === "join" && ["round", "bevel", "miter"].includes(value)) this.editor.setStrokeStyle({ join: value as StrokeStyle["join"] });
    else if (key === "cap" && ["butt", "square", "round"].includes(value)) this.editor.setStrokeStyle({ cap: value as StrokeStyle["cap"] });
  }
  setStyleScope(scope: "fill" | "stroke" | "both") { this.editor.styleScope.set(scope); }
  paintColor(target: "fill" | "stroke") {
    const selected = this.editor.selected();
    return !this.usesStyleDefaults() && selected && !selected.guide ? selected[target] : this.editor[target]();
  }
  paintWidth() { const selected = this.editor.selected(); return !this.usesStyleDefaults() && selected && !selected.guide ? selected.strokeWidth : this.editor.size(); }
  openPaint(target: "fill" | "stroke", event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.paintTarget.set(target);
    // The popover opens beside the square and is placed properly once it has been measured.
    this.paintPicker.set({ x: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 260)), y: Math.max(8, rect.top) });
  }
  /**
   * Keeps the appearance popover on the screen: once it is rendered its own height says
   * where it fits, which the square alone cannot, since the two targets differ in height.
   */
  @ViewChild("paintPopover") set paintPopoverHost(element: ElementRef<HTMLElement> | undefined) {
    const picker = this.paintPicker();
    if (!element || !picker) return;
    const height = element.nativeElement.offsetHeight;
    const top = Math.max(8, Math.min(picker.y, window.innerHeight - height - 8));
    if (Math.abs(top - picker.y) > 0.5) this.paintPicker.set({ ...picker, y: top });
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
  /** What the fill holds: a colour, a gradient, a pattern or nothing. */
  fillKind(): "color" | "gradient" | "pattern" | "none" {
    if (this.paintColor("fill") === "none") return "none";
    return this.editor.currentFillPaint()?.kind ?? "color";
  }
  setFillKind(kind: string) {
    if (kind === "none") { this.editor.setPaint("fill", "none"); return; }
    if (kind === "color") {
      const color = this.paintColor("fill");
      this.editor.setPaint("fill", color === "none" ? "#000000" : color);
      return;
    }
    if (kind === "gradient") { this.editor.setFillPaint(this.gradientPaint()); return; }
    if (kind === "pattern") {
      const id = this.editor.document().patterns?.[0]?.id ?? this.editor.usePresetPattern("dots");
      if (id) this.editor.setFillPaint({ kind: "pattern", patternId: id });
    }
  }
  /** The gradient being edited: the fill's own, or the one new gradients start from. */
  gradientPaint(): GradientPaint {
    const paint = this.editor.currentFillPaint();
    return structuredClone(paint?.kind === "gradient" ? paint : this.editor.gradient());
  }
  updateGradient(change: (gradient: GradientPaint) => void) {
    const gradient = this.gradientPaint();
    change(gradient);
    gradient.stops.sort((a, b) => a.location - b.location);
    if (validGradient(gradient)) this.editor.setFillPaint(gradient);
  }
  setGradientType(type: string) { if (type === "linear" || type === "radial") this.updateGradient((g) => { g.type = type; }); }
  setGradientAngle(event: Event) {
    const angle = this.number(event);
    if (Number.isFinite(angle) && angle >= -180 && angle <= 180) this.updateGradient((g) => { g.angle = angle; delete g.vector; });
  }
  setStop(index: number, key: "color" | "location" | "midpoint", event: Event) {
    const value = key === "color" ? this.text(event) : this.number(event);
    this.updateGradient((g) => {
      const stop = g.stops[index];
      if (!stop) return;
      if (key === "color" && typeof value === "string") stop.color = value;
      if (key === "location" && typeof value === "number" && value >= 0 && value <= 100) stop.location = value;
      if (key === "midpoint" && typeof value === "number" && value >= 13 && value <= 87) stop.midpoint = value;
    });
  }
  /** Adds a stop in the widest gap, in the colour the gradient already has there. */
  addStop() {
    this.updateGradient((g) => {
      if (g.stops.length >= 32) return;
      let at = 0;
      for (let i = 1; i < g.stops.length; i++) if (g.stops[i].location - g.stops[i - 1].location > g.stops[at + 1].location - g.stops[at].location) at = i - 1;
      const location = (g.stops[at].location + g.stops[at + 1].location) / 2;
      g.stops.splice(at + 1, 0, { color: gradientColorAt(g, location / 100).slice(0, 7), location, midpoint: 50 });
    });
  }
  removeStop(index: number) { this.updateGradient((g) => { if (g.stops.length > 2) g.stops.splice(index, 1); }); }
  /** Reverse Gradient: the stops change places, their midpoints with them. */
  reverseGradient() {
    this.updateGradient((g) => {
      const stops = g.stops.map((stop) => ({ ...stop }));
      g.stops = stops.reverse().map((stop, i, all) => ({ ...stop, location: 100 - stop.location, midpoint: all[i + 1] ? 100 - all[i + 1].midpoint : 50 }));
    });
  }
  /** A CSS picture of a gradient, for the previews of the panel and the swatches. */
  gradientCss(gradient: GradientPaint): string {
    const stops = renderedStops(gradient).map((stop) => `${stop.color} ${Math.round(stop.offset * 1000) / 10}%`).join(", ");
    return gradient.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${90 - gradient.angle}deg, ${stops})`;
  }
  /** A CSS picture of a pattern: its tile drawn as SVG and repeated. */
  patternCss(pattern: PatternDefinition): string {
    const svg = svgExport({ ...blankDocument(), version: 2, width: pattern.width, height: pattern.height, background: "none", layers: pattern.layers });
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / ${Math.max(6, Math.min(24, pattern.width))}px auto repeat`;
  }
  fillPatternId(): string | null { const paint = this.editor.currentFillPaint(); return paint?.kind === "pattern" ? paint.patternId : null; }
  choosePattern(id: string) { this.editor.setFillPaint({ kind: "pattern", patternId: id }); }
  choosePresetPattern(kind: PresetPattern) {
    const id = this.editor.usePresetPattern(kind);
    if (id) this.editor.setFillPaint({ kind: "pattern", patternId: id });
  }
  /** The channels of the colour being edited, in the model the colour mode shows. */
  rgbChannels() { const hex = this.paintBaseColor(); return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }; }
  setRgbChannel(key: "r" | "g" | "b", event: Event) {
    const value = Math.round(this.number(event));
    if (!Number.isFinite(value) || value < 0 || value > 255) return;
    const c = { ...this.rgbChannels(), [key]: value };
    this.setPaintBaseColor("#" + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join(""));
  }
  cmykChannels() { return rgbToCmyk(this.paintBaseColor()); }
  setCmykChannel(key: "c" | "m" | "y" | "k", event: Event) {
    const value = this.number(event);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    const c = { ...this.cmykChannels(), [key]: value };
    this.setPaintBaseColor(cmykToRgb(c.c, c.m, c.y, c.k));
  }
  grayLevel() { return rgbToGray(this.paintBaseColor()); }
  setGrayLevel(event: Event) {
    const value = this.number(event);
    if (Number.isFinite(value) && value >= 0 && value <= 100) this.setPaintBaseColor(grayToRgb(value));
  }
  /** The swatches the panel lists, filtered by kind as Show Swatch Kinds does. */
  visibleSwatches(): Swatch[] {
    const kind = this.swatchKind();
    return this.editor.documentSwatches().filter((swatch) => kind === "all" || swatch.kind === kind);
  }
  swatchBackground(swatch: Swatch): string {
    if (swatch.kind === "color") return swatch.color;
    if (swatch.kind === "gradient") return this.gradientCss(swatch.gradient);
    const pattern = this.editor.document().patterns?.find((p) => p.id === swatch.patternId);
    return pattern ? this.patternCss(pattern) : "";
  }
  pickSwatch(swatch: Swatch) {
    this.chosenSwatch.set(swatch.id);
    this.editor.applySwatch(swatch.id, this.swatchTarget());
  }
  newSwatch() { const id = this.editor.addSwatch(this.swatchTarget()); if (id) this.chosenSwatch.set(id); }
  deleteSwatch() { const id = this.chosenSwatch(); if (id && this.editor.removeSwatch(id)) this.chosenSwatch.set(null); }
  setSwatchKind(kind: string) { if (["all", "color", "gradient", "pattern"].includes(kind)) this.swatchKind.set(kind as "all" | "color" | "gradient" | "pattern"); }
  @HostListener("document:pointerdown", ["$event"]) dismissPaint(event: PointerEvent) {
    if (!(event.target instanceof Element) || !event.target.closest(".paint-popover,.paint-trigger")) this.paintPicker.set(null);
  }
  setUnit(key: "distanceUnit" | "fontUnit", event: Event) { const unit = this.text(event); if (isUnit(unit)) this.preferences.setMeasurement(key, unit); }
  /** Formatting only: measurements are shown with the configured decimal places, never stored rounded. */
  setCheckerSize(event: Event) {
    const size = Math.round(this.number(event));
    if (Number.isFinite(size) && size >= 2 && size <= 64) this.preferences.setMeasurement("transparencyCheckerSize", size);
  }
  setDisplayDecimals(event: Event) {
    const places = Math.round(this.number(event));
    if (Number.isFinite(places) && places >= 0 && places <= 8) this.preferences.setMeasurement("displayDecimals", places);
  }
  displayDistance(value: number) { return Number(fromPixels(value, this.preferences.distanceUnit()).toFixed(this.preferences.displayDecimals())); }
  /** Full precision, for comparisons and limits that must not be rounded. */
  exactDistance(value: number) { return Number(fromPixels(value, this.preferences.distanceUnit()).toFixed(8)); }
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
  rulerTicks(axis: "vertical" | "horizontal") { return makeRulerTicks(axis === "vertical" ? this.editor.document().height : this.editor.document().width, this.editor.zoom(), this.preferences.distanceUnit(), this.preferences.rulerStep(), this.preferences.rulerMinorStep()); }
  gridSpacing() { return this.preferences.gridSize() * this.editor.zoom(); }
  visibleGuides() { return this.editor.document().layers.filter((layer) => layer.guide && layer.visible); }
  startGuide(event: PointerEvent, axis: "vertical" | "horizontal", id?: string) {
    if (event.button !== 0 || !this.canvas || (id && this.preferences.guidesLocked())) return;
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
    this.cursorPoint.set({ x: event.clientX, y: event.clientY });
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
    this.watchPhoneWidth();
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
    this.spatialView?.dispose();
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
              "reshape",
            ].includes(this.activeTool()),
            showHandles: this.editor.showHandles(),
            boundingBox: this.editor.boundingBoxVisible(),
            meshNode: this.editor.meshNode()?.index,
            quad: this.activeTool() === "freeTransform" ? (this.editor.freeQuad() ?? this.editor.freeTransformQuad() ?? undefined) : undefined,
            outline: this.editor.outlineView(),
            outlineInk: this.theme?.() === "light" ? "#202b3f" : "#e5e9f0",
            handleSize: this.editor.handleSize(),
            anchors: this.anchorDisplay(),
          },
        );
    });
  }
  /** What the renderer needs to show anchors and handles as Illustrator does. */
  private anchorDisplay() {
    const editor = this.editor, primary = editor.selected(), layers = editor.selectedLayers();
    const others: Record<string, { selected: string[]; handles: string[] }> = {};
    for (const layer of layers) {
      if (!layer.curves || (layers.length === 1 && layer.id === primary?.id)) continue;
      const selected = editor.anchorKeysOf(layer.id);
      if (selected.length) others[layer.id] = { selected, handles: [...editor.visibleHandles(layer)] };
    }
    const hover = editor.hoverAnchor();
    return {
      selected: primary ? editor.anchorKeysOf(primary.id) : [],
      handles: primary?.curves ? [...editor.visibleHandles(primary)] : [],
      hover: editor.highlightAnchors() && hover && hover.id === primary?.id ? hover.key : null,
      focal: editor.tool() === "reshape" ? editor.reshapeFocal() : [],
      size: editor.anchorDisplay(),
      handleStyle: editor.handleStyle(),
      others,
    };
  }
  areaSelectionPath() {
    const area = this.editor.areaSelection();
    if (!area) return "";
    const { start, end } = area;
    if (area.kind === "rectangle") return `M${start.x} ${start.y}H${end.x}V${end.y}H${start.x}Z`;
    if (area.kind === "ellipse") {
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      return `M${start.x - radius} ${start.y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
    }
    return `M${start.x} ${start.y}` + area.points.map(point => `L${point.x} ${point.y}`).join("") + "Z";
  }
  // Phones. Below the phone width the tools and the panels become drawers that slide in
  // from the left and right edges, the menus fold behind a menu button, a long press
  // stands for the right button and two fingers zoom the canvas or transform the selection.
  readonly mobile = signal(typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches);
  readonly mobileMenu = signal(false);
  readonly toolsOpen = signal(false);
  readonly panelsOpen = signal(false);
  private phoneQuery?: MediaQueryList;
  private swipeStart: { point: { x: number; y: number }; id: number } | null = null;
  private longPress?: { timer: ReturnType<typeof setTimeout>; id: number; x: number; y: number; target: EventTarget | null; native: boolean };
  private touches = new Map<number, { x: number; y: number }>();
  private pinch?: {
    mode: "view" | "transform";
    start: [{ x: number; y: number }, { x: number; y: number }];
    ids: [number, number];
    zoom: number;
    origin: { x: number; y: number };
  };
  /** Follows the phone width, so turning a tablet or resizing a window switches the layout. */
  watchPhoneWidth() {
    if (typeof matchMedia !== "function") return;
    this.phoneQuery = matchMedia(PHONE_QUERY);
    this.phoneQuery.addEventListener?.("change", (event) => {
      this.mobile.set(event.matches);
      if (!event.matches) this.closeDrawers();
    });
  }
  toggleMobileMenu() {
    this.mobileMenu.update((open) => !open);
    if (this.mobileMenu()) { this.toolsOpen.set(false); this.panelsOpen.set(false); }
  }
  openDrawer(side: "tools" | "panels") {
    this.mobileMenu.set(false);
    this.toolsOpen.set(side === "tools");
    this.panelsOpen.set(side === "panels");
  }
  closeDrawers() {
    this.toolsOpen.set(false);
    this.panelsOpen.set(false);
    this.mobileMenu.set(false);
  }
  /** A finger that lands near a side edge may be opening the drawer on that side. */
  @HostListener("document:pointerdown", ["$event"]) touchStart(event: PointerEvent) {
    if (event.pointerType !== "touch") return;
    this.swipeStart = this.mobile() ? { point: { x: event.clientX, y: event.clientY }, id: event.pointerId } : null;
    this.startLongPress(event);
  }
  @HostListener("document:pointermove", ["$event"]) touchMove(event: PointerEvent) {
    if (event.pointerType !== "touch" || !this.longPress || this.longPress.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - this.longPress.x, event.clientY - this.longPress.y) > LONG_PRESS_SLOP) this.cancelLongPress();
  }
  @HostListener("document:pointerup", ["$event"]) touchEnd(event: PointerEvent) {
    if (event.pointerType !== "touch") return;
    this.cancelLongPress();
    const start = this.swipeStart;
    this.swipeStart = null;
    if (!start || start.id !== event.pointerId || !this.mobile()) return;
    const swipe = edgeSwipe(start.point, { x: event.clientX, y: event.clientY }, window.innerWidth, { left: this.toolsOpen(), right: this.panelsOpen() });
    if (swipe === "openLeft") this.openDrawer("tools");
    else if (swipe === "openRight") this.openDrawer("panels");
    else if (swipe === "closeLeft") this.toolsOpen.set(false);
    else if (swipe === "closeRight") this.panelsOpen.set(false);
  }
  @HostListener("document:pointercancel", ["$event"]) touchCancelled(event: PointerEvent) {
    if (event.pointerType !== "touch") return;
    this.cancelLongPress();
    this.swipeStart = null;
  }
  /**
   * A finger resting on the screen opens the context menu, since a phone has no right
   * button. The press is turned into the context menu event of whatever it rests on, so
   * the canvas, the layers and the guides each open their own menu; a browser that opens
   * one by itself on a long press is left to do so.
   */
  private startLongPress(event: PointerEvent) {
    this.cancelLongPress();
    if (!event.isPrimary) return;
    const target = event.target;
    const press = { id: event.pointerId, x: event.clientX, y: event.clientY, target, native: false, timer: setTimeout(() => this.fireLongPress(), LONG_PRESS_MS) };
    this.longPress = press;
  }
  private cancelLongPress() {
    if (this.longPress) clearTimeout(this.longPress.timer);
    this.longPress = undefined;
  }
  private fireLongPress() {
    const press = this.longPress;
    this.longPress = undefined;
    if (!press || press.native || !(press.target instanceof Element)) return;
    // A press that started a drawing gesture on the canvas gives it up for the menu.
    if (press.target.closest("canvas") && this.pointerActive) this.pointerCancel();
    this.syntheticContext = true;
    press.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: press.x, clientY: press.y, button: 2 }));
    this.syntheticContext = false;
  }
  private syntheticContext = false;
  @HostListener("document:contextmenu") nativeContext() {
    // The browser opened a menu of its own on the long press, so ours is not needed.
    if (!this.syntheticContext && this.longPress) { this.longPress.native = true; this.cancelLongPress(); }
  }
  /**
   * Two fingers on the canvas. Landing on the selection, they scale it in proportion,
   * turn it and move it around its pivot; anywhere else they zoom the canvas around
   * themselves and pan it. Whatever the first finger had started is taken back.
   */
  private touchDown(event: PointerEvent): boolean {
    if (event.pointerType !== "touch") return false;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size !== 2) return this.touches.size > 2 || !!this.pinch;
    this.cancelLongPress();
    if (this.pointerActive) this.pointerCancel();
    const [[idA, a], [idB, b]] = [...this.touches.entries()];
    const middle = this.point({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 } as PointerEvent);
    const bounds = this.editor.selectedLayers().length ? selectionBounds(this.editor.selectedLayers()) : null;
    const pad = 24 / this.editor.zoom();
    const onSelection = !!bounds && middle.x >= bounds.x - pad && middle.x <= bounds.x + bounds.width + pad && middle.y >= bounds.y - pad && middle.y <= bounds.y + bounds.height + pad;
    const mode = onSelection && this.editor.startTouchTransform() ? "transform" : "view";
    const rect = this.canvas!.nativeElement.getBoundingClientRect();
    this.pinch = { mode, start: [a, b], ids: [idA, idB], zoom: this.editor.zoom(), origin: { x: rect.left, y: rect.top } };
    return true;
  }
  private touchMoveCanvas(event: PointerEvent): boolean {
    if (event.pointerType !== "touch" || !this.touches.has(event.pointerId)) return false;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = this.pinch;
    if (!pinch) return false;
    const a = this.touches.get(pinch.ids[0]), b = this.touches.get(pinch.ids[1]);
    if (!a || !b) return true;
    const change = twoFingerChange(pinch.start, [a, b]);
    if (pinch.mode === "transform") {
      const zoom = this.editor.zoom();
      this.editor.touchTransform(change.scale, change.rotation, { x: change.shift.x / zoom, y: change.shift.y / zoom });
      return true;
    }
    const nextZoom = Math.min(3, Math.max(0.1, pinch.zoom * change.scale));
    const fingers = pairOf(pinch.start[0], pinch.start[1]).middle, now = pairOf(a, b).middle;
    const target = zoomAround(pinch.origin, pinch.zoom, nextZoom, fingers, now);
    this.setZoom(nextZoom);
    // The canvas takes its new size on the next frame; the view is then scrolled so the
    // point under the fingers stays there.
    requestAnimationFrame(() => {
      const view = this.viewport?.nativeElement, canvas = this.canvas?.nativeElement;
      if (!view || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      view.scrollLeft += rect.left - target.x;
      view.scrollTop += rect.top - target.y;
    });
    return true;
  }
  private touchUpCanvas(event: PointerEvent): boolean {
    if (event.pointerType !== "touch") return false;
    this.touches.delete(event.pointerId);
    if (this.pinch && this.touches.size < 2) {
      if (this.pinch.mode === "transform") this.editor.end();
      this.pinch = undefined;
      // The finger still down after a two-finger gesture draws nothing when it lifts.
      this.pinchResidue = this.touches.size > 0;
      return true;
    }
    if (this.pinchResidue) {
      this.pinchResidue = this.touches.size > 0;
      return true;
    }
    return false;
  }
  private pinchResidue = false;
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
  /** True between a canvas press and its release; a capture lost afterwards is not a cancellation. */
  private pointerActive = false;
  /** A double press on the pivot mark sends it back to the centre of the selection. */
  canvasDoubleClick(event: MouseEvent) {
    if (event.button !== 0) return;
    if (this.editor.resetPivotAt(this.point(event))) event.preventDefault();
  }
  // Object > Path: Join asks for the kind of a joined point, Average for its axis, and
  // Simplify previews its result while its dialog is open.
  readonly joinDialog = signal(false);
  readonly averageDialog = signal(false);
  readonly averageAxis = signal<"horizontal" | "vertical" | "both">("both");
  readonly simplifyDialog = signal(false);
  readonly simplifySettings = signal<SimplifyOptions & { preview: boolean; showOriginal: boolean }>({ ...DEFAULT_SIMPLIFY, preview: true, showOriginal: false });
  readonly simplifyCounts = signal<{ original: number; current: number } | null>(null);
  runJoin(kind?: "corner" | "smooth") {
    const result = this.editor.joinSelection(kind);
    this.joinDialog.set(result === "chooseKind");
  }
  openAverage() {
    this.dismissMenus();
    this.averageDialog.set(true);
  }
  applyAverage() {
    if (this.editor.averageSelection(this.averageAxis())) this.averageDialog.set(false);
  }
  openSimplify() {
    this.dismissMenus();
    if (!this.editor.selectedLayers().some((l) => l.kind === "path" && l.curves)) { this.editor.status.set("Select the paths to simplify."); return; }
    this.simplifyDialog.set(true);
    this.updateSimplify({});
  }
  updateSimplify(change: Partial<SimplifyOptions & { preview: boolean; showOriginal: boolean }>) {
    const next = { ...this.simplifySettings(), ...change };
    next.precision = Math.min(100, Math.max(0, Number(next.precision) || 0));
    next.angleThreshold = Math.min(180, Math.max(0, Number(next.angleThreshold) || 0));
    this.simplifySettings.set(next);
    this.editor.simplifyShowOriginal.set(next.showOriginal);
    this.simplifyCounts.set(this.editor.previewSimplify(next, next.preview));
  }
  finishSimplify(apply: boolean) {
    if (apply) this.editor.previewSimplify(this.simplifySettings(), true);
    this.editor.simplifyShowOriginal.set(false);
    this.editor.finishSimplify(apply);
    this.simplifyDialog.set(false);
    this.simplifyCounts.set(null);
  }
  // The option dialogs of the freehand tools, opened by double-clicking the tool.
  readonly toolOptions = signal<"path" | "paintbrush" | "smooth" | "eraser" | null>(null);
  readonly toolOptionsDraft = signal<FreehandToolOptions>({ ...PENCIL_DEFAULTS });
  /** [ and ] change the Eraser's diameter while the Eraser is the tool, as in Illustrator. */
  resizeEraser(step: number) {
    if (this.editor.tool() !== "eraser") return;
    this.editor.resizeEraser(step);
    this.preferences.updatePathSettings({ eraser: this.editor.eraserShape() });
  }
  openToolOptions(id: ToolId) {
    if (id === "scale" || id === "shear") { this.openAffineDialog(id); return; }
    if (this.editor.isLiquifyTool(id)) { this.openLiquifyOptions(id); return; }
    if (id === "eraser") {
      this.flyout.set(null);
      this.brushDraft.set({ kind: "calligraphic", ...this.editor.eraserShape() });
      this.toolOptions.set("eraser");
      return;
    }
    if (id !== "path" && id !== "paintbrush" && id !== "smooth") return;
    this.flyout.set(null);
    const current = id === "path" ? this.editor.pencilOptions() : id === "paintbrush" ? this.editor.paintbrushOptions() : { ...PENCIL_DEFAULTS, ...this.editor.smoothOptions() };
    this.toolOptionsDraft.set({ ...current });
    this.brushDraft.set({ ...this.editor.activeBrushStroke() });
    this.toolOptions.set(id);
  }
  /** The calligraphic brush the Paintbrush dialog edits until it is applied. */
  readonly brushDraft = signal<BrushStroke>({ ...DEFAULT_BRUSH_STROKE });
  toolOptionsTitle(id: "path" | "paintbrush" | "smooth" | "eraser") {
    return id === "path" ? "Pencil tool options" : id === "paintbrush" ? "Paintbrush tool options" : id === "eraser" ? "Eraser tool options" : "Smooth tool options";
  }
  setBrushStroke(key: "angle" | "roundness" | "diameter", value: number) {
    if (!Number.isFinite(value)) return;
    const limits = { angle: [-180, 180], roundness: [0, 100], diameter: [0.1, 1296] }[key];
    this.brushDraft.update((brush) => ({ ...brush, [key]: Math.min(limits[1], Math.max(limits[0], value)) }));
  }
  setToolOption<K extends keyof FreehandToolOptions>(key: K, value: FreehandToolOptions[K]) {
    this.toolOptionsDraft.update((draft) => ({ ...draft, [key]: value }));
  }
  resetToolOptions() {
    const id = this.toolOptions();
    if (id === "eraser") { this.brushDraft.set({ kind: "calligraphic", angle: 0, roundness: 100, diameter: 10 }); return; }
    this.toolOptionsDraft.set({ ...(id === "paintbrush" ? PAINTBRUSH_DEFAULTS : id === "smooth" ? { ...PENCIL_DEFAULTS, ...SMOOTH_DEFAULTS } : PENCIL_DEFAULTS) });
  }
  applyToolOptions() {
    const id = this.toolOptions();
    if (id === "eraser") {
      const { angle, roundness, diameter } = this.brushDraft();
      this.editor.eraserShape.set({ angle, roundness, diameter: Math.max(1, diameter) });
      this.preferences.updatePathSettings({ eraser: this.editor.eraserShape() });
      this.toolOptions.set(null);
      return;
    }
    const draft = validFreehandTool(this.toolOptionsDraft(), id === "paintbrush" ? PAINTBRUSH_DEFAULTS : PENCIL_DEFAULTS);
    if (id === "path") this.editor.pencilOptions.set(draft);
    if (id === "paintbrush") this.editor.paintbrushOptions.set(draft);
    if (id === "smooth") this.editor.smoothOptions.set({ fidelity: draft.fidelity, smoothness: draft.smoothness });
    if (id === "paintbrush") this.editor.activeBrushStroke.set({ ...this.brushDraft() });
    this.preferences.saveToolOptions({ pencil: this.editor.pencilOptions(), paintbrush: this.editor.paintbrushOptions(), smooth: this.editor.smoothOptions(), brush: this.editor.activeBrushStroke() });
    this.toolOptions.set(null);
  }
  // Duplication in series: the dialog holds the settings until they are applied.
  readonly arrayDialog = signal(false);
  readonly arraySettings = signal<ArraySettings>({ ...DEFAULT_ARRAY });
  get arrayModes() { return ARRAY_MODES; }
  openArrayDialog() {
    this.dismissMenus();
    this.dismissContext();
    if (!this.editor.selectedLayers().length) { this.editor.status.set("Select the objects to duplicate."); return; }
    this.arrayDialog.set(true);
  }
  setArray<K extends keyof ArraySettings>(key: K, value: ArraySettings[K]) {
    this.arraySettings.update((settings) => ({ ...settings, [key]: value }));
  }
  setArrayNumber(key: "copies" | "stepX" | "stepY" | "rotation" | "scale" | "sweep" | "columns" | "rows" | "gapX" | "gapY", event: Event) {
    const value = this.number(event);
    if (Number.isFinite(value)) this.setArray(key, value);
  }
  arrayValid() { return validArraySettings(this.arraySettings()); }
  applyArray() {
    if (!this.editor.duplicateSeries(this.arraySettings())) {
      this.editor.status.set("The series cannot be created with these settings.");
      return;
    }
    this.arrayDialog.set(false);
  }
  // Export and print: one dialog chooses the format and which open documents are included.
  readonly exportDialog = signal(false);
  readonly exportFormat = signal<"png" | "svg" | "pdf">("pdf");
  readonly exportTabs = signal<string[]>([]);
  readonly exportFormats = [
    { id: "pdf", label: "PDF document" },
    { id: "svg", label: "SVG drawing" },
    { id: "png", label: "PNG image" },
  ];
  openExport() {
    this.dismissMenus();
    this.exportTabs.set([this.editor.activeTabId()]);
    this.exportDialog.set(true);
  }
  /** The export list as table data: one row per open document, named and tagged. */
  exportColumns() { return [{ key: "name", label: this.t("Document"), noteKey: "note" }]; }
  exportRows() {
    return this.editor.tabs().map((tab) => ({ id: tab.id, name: tab.name, note: tab.active ? this.t("Current document") : "" }));
  }
  toggleExportTab(id: string, checked: boolean) {
    this.exportTabs.update((ids) => (checked ? [...new Set([...ids, id])] : ids.filter((entry) => entry !== id)));
  }
  /** The chosen documents, in the order of the tab strip, or the active one on its own. */
  private exportSelection() {
    const chosen = this.editor.tabOrder().filter((id) => this.exportTabs().includes(id));
    return chosen.length ? chosen : [this.editor.activeTabId()];
  }
  async runExport() {
    const tabs = this.exportSelection();
    this.exportDialog.set(false);
    try {
      await this.editor.exportAs(this.exportFormat(), tabs);
    } catch (error) {
      this.notify(error);
    }
  }
  async exportAsPdf() {
    this.dismissMenus();
    try {
      await this.editor.exportPdf([this.editor.activeTabId()]);
    } catch (error) {
      this.notify(error);
    }
  }
  printSelection() {
    const tabs = this.exportDialog() ? this.exportSelection() : [this.editor.activeTabId()];
    this.dismissMenus();
    this.exportDialog.set(false);
    try {
      this.editor.printDocuments(tabs);
    } catch (error) {
      this.notify(error);
    }
  }
  pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (this.touchDown(event)) return;
    // Near a side edge a phone finger is opening a drawer, not drawing.
    if (event.pointerType === "touch" && this.mobile() && (event.clientX <= EDGE_ZONE || event.clientX >= window.innerWidth - EDGE_ZONE)) return;
    this.canvas!.nativeElement.setPointerCapture(event.pointerId);
    this.pointerActive = true;
    if (this.zoomAreaActive(event)) { this.beginZoomArea(event); return; }
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
      this.altClick = event.altKey && (tool === "scale" || tool === "shear") ? { tool, x: event.clientX, y: event.clientY } : undefined;
      this.stopLiquifyTimer();
      if (this.editor.isLiquifyTool(tool) && !event.altKey) this.liquifyTimer = setInterval(() => this.editor.liquifyTick(), 60);
      this.editor.start(
        this.point(event),
        {
          shift: event.shiftKey,
          alt: event.altKey,
          ctrl: event.ctrlKey,
        },
        this.temporarySelect() ? this.temporarySelectionTool() : undefined,
      );
      if (tool === "text") {
        this.editor.end();
        this.editText();
      }
    }
  }
  pointerMove(event: PointerEvent) {
    if (this.touchMoveCanvas(event) || this.pinchResidue) return;
    this.cursorPoint.set({ x: event.clientX, y: event.clientY });
    if (this.altHeld && this.altHeld() !== event.altKey) this.altHeld.set(event.altKey);
    if (this.zoomDrag) { this.updateZoomArea(event); return; }
    if (this.pan) {
      const view = this.viewport!.nativeElement;
      view.scrollLeft = this.pan.left - event.clientX + this.pan.x;
      view.scrollTop = this.pan.top - event.clientY + this.pan.y;
    } else
      this.editor.move(this.point(event), {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        // Space held during a Pen drag moves the anchor being placed.
        ...(this.spaceHeld ? { space: true } : {}),
      });
  }
  pointerUp(event?: PointerEvent) {
    if (event && this.touchUpCanvas(event)) return;
    this.pointerActive = false;
    if (this.zoomDrag) { this.endZoomArea(); return; }
    this.pan = undefined;
    this.stopLiquifyTimer();
    this.editor.end(event ? { alt: event.altKey } : undefined);
    const click = this.altClick;
    this.altClick = undefined;
    if (click && event && Math.hypot(event.clientX - click.x, event.clientY - click.y) < 3) this.openAffineDialog(click.tool);
  }
  /** Browsers release capture after every pointerup; only an interrupted press cancels the gesture. */
  pointerLost() {
    if (this.pointerActive) this.pointerCancel();
  }
  pointerCancel() {
    this.pointerActive = false;
    if (this.zoomDrag) { this.zoomDrag = undefined; this.zoomArea.set(null); return; }
    if (this.guideDrag) this.cancelGuide();
    this.pan = undefined;
    this.stopLiquifyTimer();
    this.editor.cancel();
  }
  private renderDocument() {
    const preview = this.editor.previewDocument();
    const doc = this.preferences.dimensionsVisible() ? preview : { ...preview, layers: preview.layers.filter(layer => !layer.dimension) };
    const id = this.textEditing();
    return id
      ? {
          ...doc,
          layers: doc.layers.map((l) => (l.id === id ? this.editor.previewText(l, this.textDraft()) : l)),
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
      this.editor.updateLayer({ text });
    }
  }
  /**
   * The command a key runs while the writing of a text has the keyboard. A field owns the
   * keys that edit its own text, so only a command of the editor held with the control or
   * command key is taken from it.
   */
  private editorCommand(event: KeyboardEvent): string | undefined {
    if (!event.ctrlKey && !event.metaKey) return undefined;
    const command = matchShortcut(this.preferences.bindings(), event);
    return command && !FIELD_COMMANDS.includes(command) ? command : undefined;
  }
  /** Commits the text being written and leaves its object selected. */
  private finishTextEditing() {
    const id = this.textEditing();
    if (!id) return;
    this.commitText();
    this.editor.selectedId.set(id);
    this.editor.selectedIds.set([id]);
  }
  textKey(event: KeyboardEvent) {
    const editorCommand = this.editorCommand(event);
    if (editorCommand) {
      event.preventDefault();
      event.stopPropagation();
      this.finishTextEditing();
      this.runCommand(editorCommand);
      return;
    }
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
  /** Commands a tool family offers beside its tools, which give it a list of its own. */
  flyoutActionsFor(id: string): string[] {
    return (
      [...this.actionGroups, this.clipboardGroup].find((group) => group.id === id)?.commands ??
      (
        {
          rotate: ["rotateCW", "rotateCCW"],
          mirror: ["mirrorH", "mirrorV"],
          scale: ["scaleUp", "scaleDown"],
          zoom: ["zoomIn", "zoomOut", "fit"],
          // Outlining a stroke belongs with the tools that draw one, and outlining a text
          // with the tool that writes it.
          paint: ["outlineStroke"],
          text: ["outlineText"],
        } as Record<string, string[]>
      )[id] ?? []
    );
  }
  flyoutActions() {
    return this.flyoutActionsFor(this.flyout() ?? "");
  }
  /** A family shows its arrow when it has more than one tool or a command of its own. */
  familyHasOptions(family: { id: string; tools: readonly string[] }) {
    return family.tools.length > 1
      || ["rotate", "mirror", "scale", "zoom"].includes(family.id)
      || this.flyoutActionsFor(family.id).length > 0;
  }
  isGeneratedBlendLayer(id: string) { return this.editor.document().blends?.some(blend => blend.stepIds.some(step => step.includes(id))) ?? false; }
  blendStepLimit() {
    const blend = this.editor.selectedBlend();
    const leaves = blend?.backIds.length ?? Math.max(1, Math.floor(this.editor.selectedLayers().length / 2));
    const generated = blend?.stepIds.flat().length ?? 0;
    return Math.max(0, Math.min(100, Math.floor((150 - this.editor.document().layers.length + generated) / leaves)));
  }
  blendStepCount() { return this.editor.selectedBlend()?.steps ?? Math.max(1, Math.min(this.blendSteps(), this.blendStepLimit())); }
  currentBlendEasing() { return this.editor.selectedBlend()?.easing ?? this.blendEasing(); }
  get blendLimitTip() { return BLEND_LIMIT_TIP; }
  /**
   * The single piece of guidance the blend panel is worth showing right now, or null while the
   * panel does what it offers: advice belongs where the user is blocked, not beside correct work.
   */
  blendTip(): string | null {
    if (this.editor.selectedBlend()) {
      if (this.blendIsLocked()) return "Unlock the blend objects before changing the blend.";
      // Only say what the step count excludes when the count cannot grow any further.
      return this.blendStepCount() >= this.blendStepLimit() ? this.blendLimitTip : null;
    }
    if (this.editor.canCreateBlend()) return this.blendStepLimit() < 1 ? this.blendLimitTip : null;
    // Two or more objects are chosen, so the pair itself is what does not qualify.
    return this.editor.selectedLayers().length >= 2
      ? "Use vector endpoints with matching contour counts and open or closed paths. Groups must contain the same number of objects."
      : "Select two compatible unlocked objects or groups at the same hierarchy level.";
  }
  blendIsLocked() {
    const blend = this.editor.selectedBlend();
    if (!blend) return false;
    const ids = new Set([...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()]);
    return this.editor.document().layers.some(layer => ids.has(layer.id) && layer.locked);
  }
  setBlendSteps(event: Event) {
    const value = this.number(event), limit = this.blendStepLimit();
    if (!Number.isFinite(value) || limit < 1 || this.blendIsLocked()) return;
    const steps = Math.max(1, Math.min(limit, Math.round(value)));
    this.blendSteps.set(steps);
    if (this.editor.selectedBlend()) this.editor.updateBlend({ steps });
  }
  setBlendEasing(event: Event) {
    const easing = this.text(event);
    if (!this.blendEasings.some(option => option.id === easing) || this.blendIsLocked()) return;
    this.blendEasing.set(easing as BlendEasing);
    if (this.editor.selectedBlend()) this.editor.updateBlend({ easing: easing as BlendEasing });
  }
  commandEnabled(id: string) {
    if (id === "makeBlend") return this.editor.canCreateBlend() && this.blendStepLimit() > 0;
    if (id === "expandBlend" || id === "releaseBlend") return !!this.editor.selectedBlend() && !this.blendIsLocked();
    // The clipboard actions say what they need: something selected, or something copied.
    if (["copy", "cut", "duplicate", "duplicateSeries", "outlineStroke"].includes(id)) return this.editor.selectedLayers().length > 0;
    if (id === "outlineText") return this.editor.selectedLayers().some((layer) => layer.kind === "text");
    if (["lockSelection", "lockAbove", "lockOthers", "hideSelection", "hideAbove", "hideOthers"].includes(id)) return this.editor.selectedLayers().some((layer) => !layer.guide);
    if (id === "unlockAll") return this.editor.document().layers.some((layer) => layer.locked && !layer.guide);
    if (id === "definePattern") return this.editor.selectedLayers().length > 0 && this.editor.selectedLayers().every((layer) => ["rectangle", "ellipse", "path"].includes(layer.kind) && !layer.guide && !layer.dimension && !layer.procedural && !layer.symbolId && !layer.fillPaint);
    if (id === "showAll") return this.editor.document().layers.some((layer) => !layer.visible && !layer.guide);
    const paths = this.editor.selectedLayers().some((layer) => layer.kind === "path" && !!layer.curves);
    if (["joinPaths", "simplifyPath"].includes(id)) return paths;
    if (["averageAnchors", "convertCorner", "convertSmooth", "removeAnchors", "cutAtAnchors"].includes(id))
      return this.editor.selectedLayers().some((layer) => this.editor.anchorKeysOf(layer.id).length > 0);
    if (id === "transformAgain") return this.editor.selectedLayers().length > 0 && !!this.editor.lastTransform();
    if (["envelopeWarp", "envelopeMesh"].includes(id)) return this.editor.selectedLayers().some((layer) => !layer.guide && !layer.envelope);
    if (id === "envelopeTop") return this.editor.selectedLayers().length > 1;
    if (["envelopeRelease", "envelopeExpand", "envelopeResetWarp", "envelopeResetMesh"].includes(id)) return this.editor.selectedEnvelope()?.envelope?.editing === "envelope";
    if (["envelopeOptions", "envelopeEdit"].includes(id)) return !!this.editor.selectedEnvelope();
    if (["scaleDialog", "shearDialog", "transformEach"].includes(id)) return this.editor.selectedLayers().some((layer) => !layer.guide && !layer.locked);
    if (["paste", "pasteInFront", "pasteInBack"].includes(id)) return this.editor.canPaste();
    return true;
  }
  /** Edit Contents becomes Edit Envelope while the contents are being edited, as in Illustrator. */
  envelopeEditLabel() { return this.editor.selectedEnvelope()?.envelope?.editing === "contents" ? "Edit envelope" : "Edit contents"; }
  commandLabel(id: string) {
    return this.commandList.find((c) => c.id === id)?.label ?? this.tools.find(tool => "tool." + tool.id === id)?.label ?? id;
  }
  commandTitle(id: string) {
    return (
      this.t(this.commandLabel(id)) +
      (this.shortcut(id) ? " (" + this.shortcut(id) + ")" : "")
    );
  }
  /**
   * What every command does. Menus, the toolbars, the context menu and the keyboard
   * all read the same table, so a command can never reach one of them and not the others.
   */
  private commandActions(): Record<string, () => void> {
    return {
      documentFormat: () => this.openPageDialog("format"),
      expandDocument: () => this.openPageDialog("expand"),
      cropDocument: () => this.openPageDialog("crop"),
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
      duplicateSeries: () => this.openArrayDialog(),
      transformAgain: () => this.editor.transformAgain(),
      scaleDialog: () => this.openAffineDialog("scale"),
      envelopeWarp: () => this.openEnvelopeDialog("warp"),
      envelopeMesh: () => this.openEnvelopeDialog("mesh"),
      envelopeTop: () => this.editor.makeEnvelope("object"),
      envelopeRelease: () => this.editor.releaseEnvelope(),
      envelopeOptions: () => this.openEnvelopeDialog("options"),
      envelopeExpand: () => this.editor.expandEnvelope(),
      envelopeEdit: () => this.editor.toggleEnvelopeEditing(),
      envelopeResetWarp: () => this.openEnvelopeDialog("resetWarp"),
      envelopeResetMesh: () => this.openEnvelopeDialog("resetMesh"),
      shearDialog: () => this.openAffineDialog("shear"),
      transformEach: () => this.openAffineDialog("each"),
      copy: () => this.editor.copySelection(),
      cut: () => this.editor.cutSelection(),
      paste: () => this.editor.paste(),
      pasteInFront: () => this.editor.paste("front"),
      pasteInBack: () => this.editor.paste("back"),
      toggleBoundingBox: () => this.editor.toggleBoundingBox(),
      toggleOutline: () => this.editor.toggleOutlineView(),
      outlineStroke: () => this.editor.outlineStrokeSelection(),
      outlineText: () => { void this.editor.outlineTextSelection().catch((error) => this.notify(error)); },
      joinPaths: () => this.runJoin(),
      averageAnchors: () => this.openAverage(),
      simplifyPath: () => this.openSimplify(),
      convertCorner: () => this.editor.convertSelectedAnchors("corner"),
      convertSmooth: () => this.editor.convertSelectedAnchors("smooth"),
      removeAnchors: () => this.editor.removeSelectedAnchors(),
      cutAtAnchors: () => this.editor.cutAtSelectedAnchors(),
      selectStray: () => this.editor.selectStrayPoints(),
      toggleMultipleHandles: () => this.preferences.updatePathSettings({ showHandlesMultiple: !this.preferences.pathSettings().showHandlesMultiple }),
      definePattern: () => this.editor.definePattern(),
      lockSelection: () => this.editor.lockOrHide("locked", "selection"),
      lockAbove: () => this.editor.lockOrHide("locked", "above"),
      lockOthers: () => this.editor.lockOrHide("locked", "others"),
      unlockAll: () => this.editor.unlockOrShowAll("locked"),
      hideSelection: () => this.editor.lockOrHide("hidden", "selection"),
      hideAbove: () => this.editor.lockOrHide("hidden", "above"),
      hideOthers: () => this.editor.lockOrHide("hidden", "others"),
      showAll: () => this.editor.unlockOrShowAll("hidden"),
      eraserSmaller: () => this.resizeEraser(-1),
      eraserLarger: () => this.resizeEraser(1),
      remove: () => this.editor.remove(),
      finish: () => this.editor.finishPath(),
      cancel: () => {
        if (this.guideDrag) this.cancelGuide();
        this.editor.cancel();
        this.editor.finishPath();
      },
      fit: () => this.fit(),
      settings: () => this.openSettings(),
    };
  }
  runCommand(id: string) {
    this.flyout.set(null);
    if (!this.commandEnabled(id)) return;
    if (id === "displacement" || id === "rotation") { this.openTransformDialog(id); return; }
    if (id === "makeBlend") { this.editor.createBlend(this.blendStepCount(), this.currentBlendEasing()); return; }
    if (id === "expandBlend") { this.editor.expandBlend(); return; }
    if (id === "releaseBlend") { this.editor.releaseBlend(); return; }
    if (id === "regroup") { this.editor.regroup(); return; }
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
      ...this.commandActions(),
      documentFormat: () => this.openPageDialog("format"),
      expandDocument: () => this.startPageEditing("resize"),
      cropDocument: () => this.startPageEditing("crop"),
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
    // Ctrl pressed during a Free Transform drag distorts, as in Illustrator, rather than selecting.
    return this.temporarySelect() && !this.editor.isEditingCurve() && !this.editor.freeQuad()
      ? this.temporarySelectionTool()
      : this.editor.tool();
  }
  /**
   * The tool Ctrl gives while it is held: with a selection tool active, the other one;
   * with any other tool, the selection tool used last, as in Illustrator.
   */
  temporarySelectionTool(): "select" | "direct" {
    const tool = this.editor.tool();
    if (tool === "select") return "direct";
    if (tool === "direct") return "select";
    return this.editor.lastSelectionTool?.() ?? "select";
  }
  toolIcon() {
    if (this.temporaryPan()) return "hand";
    const tool = this.activeTool();
    // Alt turns a tool into its partner while it is held, as in Illustrator.
    if (this.altHeld?.()) {
      const partner: Partial<Record<ToolId, ToolId>> = { pen: "convertAnchor", addAnchor: "deleteAnchor", deleteAnchor: "addAnchor", path: "smooth", direct: "groupSelect", scissors: "addAnchor" };
      const other = partner[tool];
      if (other) return this.tools.find((t) => t.id === other)?.icon ?? other;
    }
    return this.tools.find((t) => t.id === tool)?.icon ?? "select";
  }
  /** The file of the mark a path tool shows beside the cursor. */
  cursorMark(): string | null {
    const mark = this.editor.pathCursor();
    if (!mark || this.temporaryPan() || this.temporarySelect()) return null;
    return mark === "newPath" ? "new-path" : mark;
  }
  cursorAxesPoint() {
    return this.preferences.cursorAxes() ? this.canvasCursorPosition() : null;
  }
  rulerCursorPoint() {
    return this.preferences.rulersVisible() ? this.canvasCursorPosition() : null;
  }
  private canvasCursorPosition() {
    const cursor = this.cursorPoint();
    if (
      !cursor ||
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
    // The copy cursor is the sign that releasing now leaves the original behind.
    if (this.editor.duplicatingDrag()) return "copy";
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
    if (this.mobile?.()) this.toolsOpen.set(false);
    this.commitText();
    this.editor.setTool(id);
    const mode = ({ selectRectangle: "rectangle", selectEllipse: "ellipse", selectLasso: "lasso" } as const)[id as "selectRectangle" | "selectEllipse" | "selectLasso"];
    if (mode) this.preferences.setAreaSelection(mode);
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
  /** The badge states that this preview stores work locally; it opens the local service settings. */
  openServerSettings() { this.dismissMenus(); this.dialog.set(true); void this.refreshProjects(); }
  openSettings() {
    this.settings.set(true);
    this.recording.set(null);

  }
  activeSettingsCategory() {
    return this.settingsCategories.find(category => category.id === this.settingsCategory())!;
  }
  selectSettingsCategory(id: "cursor" | "selection" | "anchors" | "measurement" | "appearance" | "shortcuts") {
    this.recording.set(null);
    this.settingsCategory.set(id);
    const panel = document.getElementById("settings-panel");
    if (panel) panel.scrollTop = 0;
  }
  settingsNavKey(event: KeyboardEvent, index: number) {
    const count = this.settingsCategories.length;
    let next: number;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      document.getElementById("settings-panel")?.focus();
      return;
    }
    if (event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowUp") next = (index + count - 1) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    const category = this.settingsCategories[next];
    this.selectSettingsCategory(category.id);
    document.getElementById("settings-tab-" + category.id)?.focus();
  }
  settingsPanelKey(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" || event.target !== event.currentTarget) return;
    event.preventDefault();
    document.getElementById("settings-tab-" + this.settingsCategory())?.focus();
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
  /** Rectangle being dragged with the zoom area tool, in client coordinates. */
  readonly zoomArea = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  private zoomDrag?: { start: { x: number; y: number } };
  private zoomAreaActive(event: { ctrlKey: boolean; metaKey?: boolean }) {
    return this.activeTool() === "zoomArea" || (this.spaceHeld && (event.ctrlKey || event.metaKey === true));
  }
  private beginZoomArea(event: PointerEvent) {
    this.zoomDrag = { start: { x: event.clientX, y: event.clientY } };
    this.zoomArea.set({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
  }
  private updateZoomArea(event: PointerEvent) {
    const drag = this.zoomDrag;
    if (!drag) return;
    this.zoomArea.set({
      x: Math.min(drag.start.x, event.clientX), y: Math.min(drag.start.y, event.clientY),
      width: Math.abs(event.clientX - drag.start.x), height: Math.abs(event.clientY - drag.start.y),
    });
  }
  /** Fits the dragged rectangle into the visible workspace and centres it. */
  private endZoomArea() {
    const area = this.zoomArea(), view = this.viewport?.nativeElement;
    this.zoomDrag = undefined;
    this.zoomArea.set(null);
    if (!area || !view || area.width < 8 || area.height < 8) return;
    const zoom = this.editor.zoom();
    const bounds = view.getBoundingClientRect();
    const world = {
      x: (area.x - bounds.left + view.scrollLeft) / zoom,
      y: (area.y - bounds.top + view.scrollTop) / zoom,
      width: area.width / zoom, height: area.height / zoom,
    };
    this.setZoom(Math.min(view.clientWidth / world.width, view.clientHeight / world.height));
    const next = this.editor.zoom();
    view.scrollLeft = (world.x + world.width / 2) * next - view.clientWidth / 2;
    view.scrollTop = (world.y + world.height / 2) * next - view.clientHeight / 2;
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
    if (key === "fontSize") this.editor.updateTextFontSize(value);
    else this.editor.updateLayer({ [key]: value });
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
      if (input.files?.[0]) await this.editor.importFile(input.files[0]);
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
        this.editor.openDocument(await file.text());
        this.fit();
      }
    } catch (error) {
      this.notify(error);
    }
    input.value = "";
  }
  /** In-app confirmation for destructive document actions; replaces native browser dialogs. */
  readonly confirmation = signal<{ title: string; message: string; action: string; run: () => void } | null>(null);
  confirm() { const pending = this.confirmation(); this.confirmation.set(null); pending?.run(); }
  newDocument() {
    this.commitText();
    if (this.editor.newDocument()) this.fit();
  }
  clearDocument() {
    this.dismissMenus();
    const clear = () => { this.commitText(); this.editor.reset(); this.fit(); };
    if (!this.editor.dirty()) { clear(); return; }
    this.confirmation.set({ title: "Unsaved changes", message: "The current document has unsaved changes. Clearing it removes all of its content.", action: "Clear anyway", run: clear });
  }
  /**
   * On a phone the document tabs become a list in the header: choosing a document shows
   * it, and the last two entries make a new document or close the one shown.
   */
  chooseDocument(event: Event) {
    const select = event.target as HTMLSelectElement;
    const active = () => this.editor.tabs().find((tab) => tab.active)?.id ?? "";
    if (select.value === "new") this.newDocument();
    else if (select.value === "close") { if (active()) this.closeDocument(active()); }
    else this.switchDocument(select.value);
    // After an action the list shows the document on screen again.
    select.value = active();
  }
  switchDocument(id: string) {
    this.commitText();
    this.editor.switchDocument(id);
    this.fit();
  }
  closeDocument(id: string) {
    const close = () => { this.commitText(); this.editor.closeDocument(id); this.fit(); };
    if (!this.editor.isDocumentDirty(id)) { close(); return; }
    this.confirmation.set({ title: "Unsaved changes", message: "This document has unsaved changes. Closing it discards them.", action: "Close without saving", run: close });
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
    if (this.confirmation?.()) {
      if (event.key === "Escape") { this.confirmation.set(null); event.preventDefault(); }
      return;
    }
    if (this.transformDialog?.()) {
      if (event.key === "Escape") { this.transformDialog.set(null); event.preventDefault(); }
      return;
    }
    if (this.contextMenu?.()) {
      if (event.key === "Escape") { this.dismissContext(); event.preventDefault(); }
      return;
    }
    if (!event.isComposing) this.temporarySelect.set(event.ctrlKey);
    // Alt pressed during a transform announces the duplication even without moving the pointer.
    this.editor?.setDuplicatingDrag(event.altKey);
    this.altHeld?.set(event.altKey);
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
      this.about() ||
      this.dialog() ||
      this.settings() ||
      this.spatial()
    )
      return;
    // A field keeps the keys that write in it; a command of the editor still runs, as it
    // does in Illustrator, and the text being written is committed before it does.
    if (target?.closest('input,textarea,select,[contenteditable="true"]') || this.textEditing()) {
      const editorCommand = this.editorCommand(event);
      if (!editorCommand) return;
      event.preventDefault();
      this.finishTextEditing();
      target?.blur?.();
      this.runCommand(editorCommand);
      return;
    }
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
      // While the Pen is placing an anchor, Space moves the anchor instead of the view.
      if (this.editor.isEditingCurve()) { this.spaceHeld = true; return; }
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
    const action = this.commandActions();
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
    this.editor?.setDuplicatingDrag(event.altKey);
    this.altHeld?.set(event.altKey);
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
      this.editor.markSaved();
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
      this.editor.openDocument(JSON.stringify(doc));
      this.dialog.set(false);
      this.fit();
    } catch (error) {
      this.notify(error);
    }
  }
  async spatialPreview() {
    this.spatial.set(true);
    this.spatialParallax.set(false);
    try {
      const { createSpatialPreview } = await import("./spatial");
      requestAnimationFrame(async () => {
        try {
          if (this.spatialHost) {
            const view = await createSpatialPreview(
              this.spatialHost.nativeElement,
              this.editor.document(),
              this.editor.renderer,
            );
            if (this.spatial()) {
              this.spatialView = view;
              view.parallax(this.spatialParallax());
            } else view.dispose();
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
  toggleParallax() {
    const enabled = !this.spatialParallax();
    this.spatialParallax.set(enabled);
    this.spatialView?.parallax(enabled);
  }
  closeSpatial() {
    this.spatialView?.dispose();
    this.spatialView = undefined;
    this.spatial.set(false);
    this.spatialParallax.set(false);
  }
}
