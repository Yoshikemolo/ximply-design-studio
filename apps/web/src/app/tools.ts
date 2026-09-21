/** Trusted built-in descriptors; shortcut assignments belong to the command registry. */
export type ToolId =
  | "wall"
  | "door"
  | "window"
  | "pillar"
  | "stair"
  | "dimensionSmart"
  | "dimensionLinear"
  | "dimensionAngular"
  | "dimensionChain"
  | "dimensionRadius"
  | "dimensionDiameter"
  | "eyedropper"
  | "paintBucket"
  | "mirror"
  | "scale"
  | "zoom"
  | "zoomArea"
  | "select"
  | "selectRectangle"
  | "selectEllipse"
  | "selectLasso"
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
  | "brushFlat"
  | "brushCalligraphy"
  | "brushMarker"
  | "brushAirbrush"
  | "brushPencil"
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
  | "knife"
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
  { id: "wall", label: "Wall", icon: "wall", group: "Draw" },
  { id: "door", label: "Door", icon: "door", group: "Draw" },
  { id: "window", label: "Window", icon: "window", group: "Draw" },
  { id: "pillar", label: "Pillar", icon: "pillar", group: "Draw" },
  { id: "stair", label: "Stair", icon: "stair", group: "Draw" },
  { id: "dimensionSmart", label: "Smart dimension", icon: "dimension-smart", group: "Draw" },
  { id: "dimensionLinear", label: "Linear dimension", icon: "dimension-linear", group: "Draw" },
  { id: "dimensionAngular", label: "Angular dimension", icon: "dimension-angular", group: "Draw" },
  { id: "dimensionChain", label: "Chain dimension", icon: "dimension-chain", group: "Draw" },
  { id: "dimensionRadius", label: "Radius dimension", icon: "dimension-radius", group: "Draw" },
  { id: "dimensionDiameter", label: "Diameter dimension", icon: "dimension-diameter", group: "Draw" },
  { id: "brushFlat", label: "Flat brush", icon: "brush-flat", group: "Paint" },
  { id: "brushCalligraphy", label: "Calligraphy brush", icon: "brush-calligraphy", group: "Paint" },
  { id: "brushMarker", label: "Marker", icon: "brush-marker", group: "Paint" },
  { id: "brushAirbrush", label: "Airbrush", icon: "brush-airbrush", group: "Paint" },
  { id: "brushPencil", label: "Pencil brush", icon: "pencil", group: "Paint" },
  { id: "eyedropper", label: "Eyedropper", icon: "eyedropper", group: "Paint" },
  { id: "paintBucket", label: "Paint bucket", icon: "paintBucket", group: "Paint" },
  { id: "mirror", label: "Reflect", icon: "mirror", group: "Select" },
  { id: "scale", label: "Scale", icon: "scale", group: "Select" },
  { id: "zoom", label: "Zoom", icon: "zoom", group: "Select" },
  { id: "zoomArea", label: "Zoom area", icon: "zoom-area", group: "Select" },
  { id: "select", label: "Select", icon: "select", group: "Select" },
  { id: "selectRectangle", label: "Rectangular selection", icon: "select-rectangle", group: "Select" },
  { id: "selectEllipse", label: "Circular selection", icon: "select-circle", group: "Select" },
  { id: "selectLasso", label: "Freehand selection", icon: "select-lasso", group: "Select" },
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
          pen: "Bézier",
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
      "knife",
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
  { id: "architecture", label: "Floor plan tools", tools: ["wall", "door", "window", "pillar", "stair"] },
  { id: "dimensions", label: "Dimensions", tools: ["dimensionSmart", "dimensionLinear", "dimensionAngular", "dimensionChain", "dimensionRadius", "dimensionDiameter"] },
  { id: "selection", label: "Select", tools: ["select", "selectRectangle", "selectEllipse", "selectLasso"] },
  { id: "direct", label: "Direct selection", tools: ["direct"] },
  {
    id: "pen",
    label: "Bézier tools",
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
  { id: "scissors", label: "Scissors", tools: ["scissors", "knife"] },
  { id: "paint", label: "Brush", tools: ["brush", "brushFlat", "brushCalligraphy", "brushMarker", "brushAirbrush", "brushPencil"] },
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
  { id: "zoom", label: "Zoom", tools: ["zoom", "zoomArea"] },
];
