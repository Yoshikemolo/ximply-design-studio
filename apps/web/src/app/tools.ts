/** Trusted built-in descriptors; shortcut assignments belong to the command registry. */
export type ToolId =
  | "eyedropper"
  | "paintBucket"
  | "mirror"
  | "scale"
  | "zoom"
  | "select"
  | "direct"
  | "pen"
  | "addAnchor"
  | "deleteAnchor"
  | "convertAnchor"
  | "rotate"
  | "rectangle"
  | "ellipse"
  | "path"
  | "text"
  | "brush"
  | "eraser"
  | "hand"
  | "line"
  | "rounded"
  | "polygon"
  | "star"
  | "arc"
  | "spiral"
  | "grid"
  | "polar"
  | "flare"
  | "smooth"
  | "scissors"
  | "pathEraser"
  | "spray"
  | "symbolShift"
  | "symbolScrunch"
  | "symbolSize"
  | "symbolSpin"
  | "symbolStain"
  | "symbolScreen"
  | "symbolStyle";
export interface ToolPlugin {
  id: ToolId;
  label: string;
  icon: string;
  group: "Select" | "Draw" | "Paths" | "Paint" | "Symbols";
}
export const TOOLS: ToolPlugin[] = [
  { id: "eyedropper", label: "Eyedropper", icon: "eyedropper", group: "Paint" },
  { id: "paintBucket", label: "Paint bucket", icon: "paintBucket", group: "Paint" },
  { id: "mirror", label: "Reflect", icon: "mirror", group: "Select" },
  { id: "scale", label: "Scale", icon: "scale", group: "Select" },
  { id: "zoom", label: "Zoom", icon: "zoom", group: "Select" },
  { id: "select", label: "Select", icon: "select", group: "Select" },
  { id: "direct", label: "Direct selection", icon: "direct", group: "Select" },
  { id: "rotate", label: "Rotate", icon: "rotate", group: "Select" },
  { id: "hand", label: "Pan", icon: "hand", group: "Select" },
  ...(
    [
      "pen",
      "rectangle",
      "rounded",
      "ellipse",
      "line",
      "polygon",
      "star",
      "arc",
      "spiral",
      "grid",
      "polar",
      "flare",
      "path",
      "text",
    ] as ToolId[]
  ).map((id) => ({
    id,
    label:
      (
        {
          pen: "Pen",
          rounded: "Rounded rectangle",
          path: "Pencil",
          polar: "Polar grid",
          grid: "Rectangular grid",
          line: "Line",
          text: "Text",
        } as Record<string, string>
      )[id] ?? id[0].toUpperCase() + id.slice(1),
    icon: id === "path" ? "pencil" : id,
    group: "Draw" as const,
  })),
  ...(
    [
      "addAnchor",
      "deleteAnchor",
      "convertAnchor",
      "smooth",
      "scissors",
      "pathEraser",
    ] as ToolId[]
  ).map((id) => ({
    id,
    label:
      (
        {
          addAnchor: "Add anchor",
          deleteAnchor: "Delete anchor",
          convertAnchor: "Convert anchor",
          pathEraser: "Path eraser",
        } as Record<string, string>
      )[id] ?? id[0].toUpperCase() + id.slice(1),
    icon: id,
    group: "Paths" as const,
  })),
  { id: "brush", label: "Brush", icon: "brush", group: "Paint" },
  { id: "eraser", label: "Eraser", icon: "eraser", group: "Paint" },
  ...(
    [
      "spray",
      "symbolShift",
      "symbolScrunch",
      "symbolSize",
      "symbolSpin",
      "symbolStain",
      "symbolScreen",
      "symbolStyle",
    ] as ToolId[]
  ).map((id) => ({
    id,
    label: (
      {
        spray: "Symbol sprayer",
        symbolShift: "Symbol shifter",
        symbolScrunch: "Symbol scruncher",
        symbolSize: "Symbol sizer",
        symbolSpin: "Symbol spinner",
        symbolStain: "Symbol stainer",
        symbolScreen: "Symbol screener",
        symbolStyle: "Symbol styler",
      } as Record<string, string>
    )[id],
    icon: id,
    group: "Symbols" as const,
  })),
];

export interface ToolFamily {
  id: string;
  label: string;
  tools: ToolId[];
}
export const TOOL_FAMILIES: ToolFamily[] = [
  { id: "selection", label: "Select", tools: ["select"] },
  { id: "direct", label: "Direct selection", tools: ["direct"] },
  {
    id: "pen",
    label: "Pen tools",
    tools: ["pen", "addAnchor", "deleteAnchor", "convertAnchor"],
  },
  {
    id: "shape",
    label: "Shape tools",
    tools: ["rectangle", "rounded", "ellipse", "polygon", "star"],
  },
  {
    id: "line",
    label: "Line tools",
    tools: ["line", "arc", "spiral", "grid", "polar", "flare"],
  },
  {
    id: "pencil",
    label: "Pencil tools",
    tools: ["path", "smooth", "pathEraser"],
  },
  { id: "text", label: "Text", tools: ["text"] },
  { id: "scissors", label: "Scissors", tools: ["scissors"] },
  { id: "paint", label: "Brush", tools: ["brush"] },
  { id: "eraser", label: "Eraser", tools: ["eraser"] },
  { id: "style", label: "Style tools", tools: ["eyedropper", "paintBucket"] },
  { id: "rotate", label: "Rotate", tools: ["rotate"] },
  { id: "mirror", label: "Reflect", tools: ["mirror"] },
  { id: "scale", label: "Scale", tools: ["scale"] },
  {
    id: "symbols",
    label: "Symbol tools",
    tools: [
      "spray",
      "symbolShift",
      "symbolScrunch",
      "symbolSize",
      "symbolSpin",
      "symbolStain",
      "symbolScreen",
      "symbolStyle",
    ],
  },
  { id: "hand", label: "Pan", tools: ["hand"] },
  { id: "zoom", label: "Zoom", tools: ["zoom"] },
];
