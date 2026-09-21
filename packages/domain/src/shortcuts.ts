export interface Command {
  id: string;
  label: string;
  keys: string[];
}
export const COMMANDS: Command[] = [
  ...Object.entries({
    eyedropper: ["Eyedropper", "I"],
    paintBucket: ["Paint bucket", "K"],
    mirror: ["Reflect", "O"],
    scale: ["Scale", "S"],
    zoom: ["Zoom", "Z"],
    select: ["Select", "V"],
    direct: ["Direct selection", "A"],
    pen: ["Bézier", "P"],
    addAnchor: ["Add anchor", "+"],
    deleteAnchor: ["Delete anchor", "-"],
    convertAnchor: ["Convert anchor", "Shift+C"],
    rectangle: ["Rectangle", "M"],
    ellipse: ["Ellipse", "L"],
    line: ["Line", "\\"],
    path: ["Pencil", "N"],
    text: ["Text", "T"],
    paintbrush: ["Paintbrush", "B"],
    eraser: ["Eraser", "Shift+E"],
    rotate: ["Rotate", "R"],
    hand: ["Pan", "H"],
    scissors: ["Scissors", "C"],
    spray: ["Symbol sprayer", "Shift+S"],
  }).map(([id, [label, key]]) => ({ id: "tool." + id, label, keys: [key] })),
  ...Object.entries({
    rounded: "Rounded rectangle",
    polygon: "Polygon",
    star: "Star",
    arc: "Arc",
    spiral: "Spiral",
    grid: "Rectangular grid",
    polar: "Polar grid",
    flare: "Flare",
    brush: "Raster brush",
    reshape: "Reshape",
    smooth: "Smooth",
    pathEraser: "Path eraser",
    symbolShift: "Symbol shifter",
    symbolScrunch: "Symbol scruncher",
    symbolSize: "Symbol sizer",
    symbolSpin: "Symbol spinner",
    symbolStain: "Symbol stainer",
    symbolScreen: "Symbol screener",
    symbolStyle: "Symbol styler",
  }).map(([id, label]) => ({ id: "tool." + id, label, keys: [] })),
  { id: "makeBlend", label: "Make blend", keys: [] },
  { id: "expandBlend", label: "Expand blend", keys: [] },
  { id: "releaseBlend", label: "Release blend", keys: [] },
  { id: "displacement", label: "Displacement", keys: ["Mod+Shift+M"] },
  { id: "rotation", label: "Rotation", keys: ["Mod+Shift+R"] },
  { id: "regroup", label: "Regroup", keys: [] },
  { id: "documentFormat", label: "Document dimensions", keys: [] },
  { id: "expandDocument", label: "Expand document", keys: [] },
  { id: "cropDocument", label: "Crop document", keys: [] },
  { id: "group", label: "Group", keys: ["Mod+G"] },
  { id: "ungroup", label: "Ungroup", keys: ["Mod+Shift+G"] },
  { id: "selectAll", label: "Select all", keys: ["Mod+A"] },
  { id: "zoomIn", label: "Zoom in", keys: ["Mod++"] },
  { id: "zoomOut", label: "Zoom out", keys: ["Mod+-"] },
  ...Object.entries({
    mirrorH: "Reflect horizontally",
    mirrorV: "Reflect vertically",
    rotateCW: "Rotate clockwise",
    rotateCCW: "Rotate counterclockwise",
    scaleUp: "Scale up",
    scaleDown: "Scale down",
    union: "Unite",
    subtract: "Minus front",
    intersect: "Intersect",
    exclude: "Exclude overlaps",
    alignLeft: "Align left",
    alignCenterX: "Align horizontal centers",
    alignRight: "Align right",
    alignTop: "Align top",
    alignCenterY: "Align vertical centers",
    alignBottom: "Align bottom",
    distributeX: "Distribute horizontally",
    distributeY: "Distribute vertically",
  }).map(([id, label]) => ({ id, label, keys: [] })),
  { id: "about", label: "About", keys: [] },
  { id: "importImage", label: "Import", keys: [] },
  { id: "exportPng", label: "Export PNG", keys: [] },
  { id: "exportSvg", label: "Export SVG", keys: [] },
  { id: "undo", label: "Undo", keys: ["Mod+Z"] },
  { id: "redo", label: "Redo", keys: ["Mod+Shift+Z"] },
  { id: "save", label: "Save project", keys: ["Mod+S"] },
  { id: "open", label: "Open project", keys: ["Mod+O"] },
  { id: "new", label: "New document", keys: ["Mod+Alt+N"] },
  { id: "duplicate", label: "Duplicate", keys: ["Mod+Alt+D"] },
  { id: "transformAgain", label: "Transform again", keys: ["Mod+D"] },
  { id: "duplicateSeries", label: "Duplicate in series", keys: ["Mod+Shift+D"] },
  { id: "copy", label: "Copy", keys: ["Mod+C"] },
  { id: "cut", label: "Cut", keys: ["Mod+X"] },
  { id: "paste", label: "Paste", keys: ["Mod+V"] },
  { id: "pasteInFront", label: "Paste in front", keys: ["Mod+F"] },
  { id: "pasteInBack", label: "Paste in back", keys: ["Mod+B"] },
  { id: "toggleBoundingBox", label: "Show or hide the bounding box", keys: ["Mod+Shift+B"] },
  { id: "toggleOutline", label: "Outline view", keys: ["Mod+Y"] },
  { id: "outlineStroke", label: "Outline stroke", keys: [] },
  { id: "outlineText", label: "Create outlines", keys: ["Mod+Shift+O"] },
  { id: "joinPaths", label: "Join", keys: ["Mod+J"] },
  { id: "averageAnchors", label: "Average", keys: ["Mod+Alt+J"] },
  { id: "simplifyPath", label: "Simplify", keys: [] },
  { id: "convertCorner", label: "Convert selected anchors to corner", keys: [] },
  { id: "convertSmooth", label: "Convert selected anchors to smooth", keys: [] },
  { id: "removeAnchors", label: "Remove selected anchor points", keys: [] },
  { id: "cutAtAnchors", label: "Cut path at selected anchor points", keys: [] },
  { id: "selectStray", label: "Select stray points", keys: [] },
  { id: "toggleMultipleHandles", label: "Show handles for multiple selected anchors", keys: [] },
  { id: "remove", label: "Delete", keys: ["Delete", "Backspace"] },
  { id: "finish", label: "Finish path", keys: ["Enter"] },
  { id: "cancel", label: "Cancel", keys: ["Escape"] },
  { id: "fit", label: "Fit", keys: ["Mod+0"] },
  { id: "settings", label: "Settings", keys: ["Mod+K"] },
  { id: "panHold", label: "Temporary pan", keys: ["Space"] },
  { id: "left", label: "Nudge left", keys: ["ArrowLeft"] },
  { id: "right", label: "Nudge right", keys: ["ArrowRight"] },
  { id: "up", label: "Nudge up", keys: ["ArrowUp"] },
  { id: "down", label: "Nudge down", keys: ["ArrowDown"] },
  { id: "leftFast", label: "Nudge left 10 px", keys: ["Shift+ArrowLeft"] },
  { id: "rightFast", label: "Nudge right 10 px", keys: ["Shift+ArrowRight"] },
  { id: "upFast", label: "Nudge up 10 px", keys: ["Shift+ArrowUp"] },
  { id: "downFast", label: "Nudge down 10 px", keys: ["Shift+ArrowDown"] },
];
export type ShortcutMap = Record<string, string[]>;
export const defaultShortcuts = (): ShortcutMap =>
  Object.fromEntries(COMMANDS.map((c) => [c.id, [...c.keys]]));
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  getModifierState?: (key: string) => boolean;
}
export function eventChord(e: KeyInput): string | null {
  if (
    e.isComposing ||
    e.getModifierState?.("AltGraph") ||
    ["Control", "Meta", "Alt", "Shift", "Dead", "Unidentified"].includes(e.key)
  )
    return null;
  let key =
    e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const shift = e.shiftKey && (key.length !== 1 || /^[A-Z]$/.test(key));
  return [
    ...(e.ctrlKey || e.metaKey ? ["Mod"] : []),
    ...(e.altKey ? ["Alt"] : []),
    ...(shift ? ["Shift"] : []),
    key,
  ].join("+");
}
export function normalizeChord(input: string): string {
  if (input.trim() === "+") return "+";
  const plus = input.trim().endsWith("++"),
    tokens = (plus ? input.trim().slice(0, -2) : input.trim())
      .split("+")
      .map((t) => t.trim()),
    key = plus ? "+" : (tokens.pop() ?? "");
  if (!key) throw new Error("Invalid shortcut");
  const modifiers = new Set(
    tokens.map((t) =>
      /^(ctrl|cmd|command|control|meta|mod)$/i.test(t)
        ? "Mod"
        : /^alt|option$/i.test(t)
          ? "Alt"
          : /^shift$/i.test(t)
            ? "Shift"
            : t,
    ),
  );
  if ([...modifiers].some((t) => !["Mod", "Alt", "Shift"].includes(t)))
    throw new Error("Invalid shortcut");
  const aliases: Record<string, string> = {
    space: "Space",
    escape: "Escape",
    esc: "Escape",
    enter: "Enter",
    delete: "Delete",
    backspace: "Backspace",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
  };
  const normalized =
    key.length === 1 ? key.toUpperCase() : aliases[key.toLowerCase()];
  if (!normalized) throw new Error("Invalid shortcut");
  if (
    modifiers.has("Shift") &&
    normalized.length === 1 &&
    !/^[A-Z]$/.test(normalized)
  )
    throw new Error("Use the resulting symbol without Shift");
  return [
    ...["Mod", "Alt", "Shift"].filter((m) => modifiers.has(m)),
    normalized,
  ].join("+");
}
export function validateShortcuts(value: unknown): ShortcutMap {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid shortcut settings");
  const input = value as Record<string, unknown>,
    out: ShortcutMap = {},
    used = new Map<string, string>();
  if (Object.keys(input).some((id) => !COMMANDS.some((c) => c.id === id)))
    throw new Error("Unknown command");
  // A chord a new command takes over from another command, when the saved settings still
  // give that command its old default rather than a choice of the person's own.
  const reassigned: Record<string, { from: string; chord: string }> = {
    "tool.paintbrush": { from: "tool.brush", chord: "B" },
  };
  const source = { ...input };
  for (const [id, move] of Object.entries(reassigned)) {
    const old = source[move.from];
    if (source[id] === undefined && Array.isArray(old) && old.length === 1 && typeof old[0] === "string" && normalizeChord(old[0]) === move.chord) {
      source[move.from] = [];
      source[id] = [move.chord];
    }
  }
  for (const command of COMMANDS) {
    // Settings saved before a command existed say nothing about it. The command takes
    // its own keys, minus any chord the saved settings already gave to another command.
    const taken = (chord: string) => Object.values(source).some((value) => Array.isArray(value)
      && value.some((key) => typeof key === "string" && normalizeChord(key) === chord));
    const keys = source[command.id] ?? command.keys.filter((chord) => !taken(chord));
    if (
      !Array.isArray(keys) ||
      keys.length > 2 ||
      keys.some((k) => typeof k !== "string")
    )
      throw new Error("Invalid shortcut settings");
    out[command.id] = keys.map(normalizeChord);
    for (const key of out[command.id]) {
      if (
        [
          "Mod+W",
          "Mod+T",
          "Mod+N",
          "Mod+R",
          "Mod+L",
          "Mod+Shift+T",
          "Alt+F4",
          "Tab",
        ].includes(key)
      )
        throw new Error("Reserved browser shortcut");
      const owner = used.get(key);
      if (owner) throw new Error(`Shortcut collision: ${key} (${owner})`);
      used.set(key, command.label);
    }
  }
  return out;
}
export function matchShortcut(
  map: ShortcutMap,
  e: KeyInput,
): string | undefined {
  const chord = eventChord(e);
  return chord
    ? Object.keys(map).find((id) => map[id].includes(chord))
    : undefined;
}
