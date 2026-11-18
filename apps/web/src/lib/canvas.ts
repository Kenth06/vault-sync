import { z } from "zod";

const Side = z.enum(["top", "right", "bottom", "left"]);

const NodeBase = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  color: z.string().optional(),
});

const CanvasNode = z.discriminatedUnion("type", [
  NodeBase.extend({ type: z.literal("text"), text: z.string() }),
  NodeBase.extend({ type: z.literal("file"), file: z.string(), subpath: z.string().optional() }),
  NodeBase.extend({ type: z.literal("link"), url: z.string() }),
  NodeBase.extend({ type: z.literal("group"), label: z.string().optional() }),
]);
export type CanvasNode = z.infer<typeof CanvasNode>;

const CanvasEdge = z.object({
  id: z.string(),
  fromNode: z.string(),
  toNode: z.string(),
  fromSide: Side.optional(),
  toSide: Side.optional(),
  label: z.string().optional(),
  color: z.string().optional(),
});
export type CanvasEdge = z.infer<typeof CanvasEdge>;

const Canvas = z.object({
  nodes: z.array(CanvasNode).default([]),
  edges: z.array(CanvasEdge).default([]),
});

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Board {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly bounds: Bounds;
}

const MARGIN = 40;
const PRESET_COLORS: Readonly<Record<string, string>> = {
  "1": "oklch(0.63 0.2 25)",
  "2": "oklch(0.72 0.16 55)",
  "3": "oklch(0.82 0.15 95)",
  "4": "oklch(0.68 0.15 150)",
  "5": "oklch(0.7 0.11 210)",
  "6": "oklch(0.6 0.15 300)",
};

export function parseCanvas(text: string): Board | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = Canvas.safeParse(json);
  if (!parsed.success) return null;
  const { nodes, edges } = parsed.data;
  if (nodes.length === 0) return { nodes, edges, bounds: { x: 0, y: 0, width: 400, height: 200 } };
  const minX = Math.min(...nodes.map((n) => n.x)) - MARGIN;
  const minY = Math.min(...nodes.map((n) => n.y)) - MARGIN;
  const maxX = Math.max(...nodes.map((n) => n.x + n.width)) + MARGIN;
  const maxY = Math.max(...nodes.map((n) => n.y + n.height)) + MARGIN;
  return { nodes, edges, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

export function canvasColor(color: string | undefined): string | null {
  if (color === undefined) return null;
  return PRESET_COLORS[color] ?? (/^#[\da-f]{3,8}$/iu.test(color) ? color : null);
}

function sideOf(from: CanvasNode, to: CanvasNode): z.infer<typeof Side> {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

function anchor(node: CanvasNode, side: z.infer<typeof Side>): Point {
  const midX = node.x + node.width / 2;
  const midY = node.y + node.height / 2;
  if (side === "top") return { x: midX, y: node.y };
  if (side === "bottom") return { x: midX, y: node.y + node.height };
  if (side === "left") return { x: node.x, y: midY };
  return { x: node.x + node.width, y: midY };
}

export function edgeEnds(edge: CanvasEdge, byId: ReadonlyMap<string, CanvasNode>): [Point, Point] | null {
  const from = byId.get(edge.fromNode);
  const to = byId.get(edge.toNode);
  if (from === undefined || to === undefined) return null;
  return [anchor(from, edge.fromSide ?? sideOf(from, to)), anchor(to, edge.toSide ?? sideOf(to, from))];
}
