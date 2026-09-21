import { parse, type Font, type PathCommand } from "opentype.js";
import { CurvePath, anchor } from "../../../../packages/domain/src/curves";
import { bundledFace, faceFile } from "../../../../packages/domain/src/text-layout";

/**
 * Reads the faces the studio carries and turns their glyphs into paths. The font file is
 * data: it is fetched from the application itself, parsed in memory and never executed,
 * and a file that cannot be read leaves the text as it was.
 */
export class FontOutlines {
  private readonly faces = new Map<string, Promise<Font>>();

  /** Loads the carried face that draws this family, saying whether it has its metrics. */
  async face(family: string, weight: number, style: string): Promise<{ font: Font; exact: boolean }> {
    const { face, exact } = bundledFace(family);
    const file = faceFile(face, weight, style);
    let pending = this.faces.get(file);
    if (!pending) {
      pending = fetch(`/assets/fonts/${file}`)
        .then((response) => {
          if (!response.ok) throw new Error("The font of this text could not be read.");
          return response.arrayBuffer();
        })
        .then((buffer) => parse(buffer));
      this.faces.set(file, pending);
    }
    try {
      return { font: await pending, exact };
    } catch (error) {
      this.faces.delete(file);
      throw error instanceof Error ? error : new Error("The font of this text could not be read.");
    }
  }
  /** The outlines of a string at a size and a place, in the coordinates of the text. */
  paths(font: Font, text: string, size: number, x: number, y: number): CurvePath[] {
    return commandsToCurves(font.getPath(text, x, y, size).commands);
  }
}
/** Font paths speak in move, line, curve and close; this editor speaks in cubic nodes. */
export function commandsToCurves(commands: readonly PathCommand[]): CurvePath[] {
  const curves: CurvePath[] = [];
  let nodes: ReturnType<typeof anchor>[] = [];
  let closed = false;
  const flush = () => {
    if (nodes.length > 1) curves.push({ nodes, closed });
    nodes = [];
    closed = false;
  };
  for (const command of commands) {
    if (command.type === "M") {
      flush();
      nodes = [anchor({ x: command.x, y: command.y })];
      continue;
    }
    if (!nodes.length) continue;
    const last = nodes[nodes.length - 1];
    if (command.type === "L") {
      nodes.push(anchor({ x: command.x, y: command.y }));
    } else if (command.type === "C") {
      last.outgoing = { x: command.x1, y: command.y1 };
      const next = anchor({ x: command.x, y: command.y });
      next.incoming = { x: command.x2, y: command.y2 };
      nodes.push(next);
    } else if (command.type === "Q") {
      // A quadratic is one cubic with both controls two thirds of the way to the apex.
      const from = last.point;
      last.outgoing = { x: from.x + (2 / 3) * (command.x1 - from.x), y: from.y + (2 / 3) * (command.y1 - from.y) };
      const next = anchor({ x: command.x, y: command.y });
      next.incoming = { x: command.x + (2 / 3) * (command.x1 - command.x), y: command.y + (2 / 3) * (command.y1 - command.y) };
      nodes.push(next);
    } else if (command.type === "Z") {
      closed = true;
      // A closing point that repeats the first one is the same node once the path is closed.
      const first = nodes[0];
      if (nodes.length > 1 && Math.hypot(last.point.x - first.point.x, last.point.y - first.point.y) < 1e-6) {
        first.incoming = { ...last.incoming };
        nodes.pop();
      }
      flush();
      closed = false;
    }
  }
  flush();
  return curves;
}
