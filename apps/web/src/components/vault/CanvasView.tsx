import { Banner } from "@cloudflare/kumo";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useVault } from "../../contexts/VaultContext.tsx";
import { canvasColor, edgeEnds, parseCanvas, type Board, type CanvasNode } from "../../lib/canvas.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { mediaKind } from "../../lib/file-kind.ts";
import { renderMarkdown } from "../../lib/markdown/render.ts";
import { noteHref } from "../../lib/routes.ts";
import { displayName } from "../../lib/tree.ts";

function FileCard({ node }: { readonly node: Extract<CanvasNode, { type: "file" }> }) {
  const { index } = useVault();
  const resolved = index.resolve(node.file, "");
  if (resolved === null) return <p className="app-soft text-sm">{node.file} is not in the vault</p>;
  if (mediaKind(resolved) === "image") {
    return (
      <img src={vaultService.currentUrl(resolved)} alt={displayName(resolved)} className="size-full object-contain" />
    );
  }
  return (
    <Link to={noteHref(resolved)} className="text-sm font-medium underline underline-offset-2">
      {displayName(resolved)}
    </Link>
  );
}

function TextCard({ text, path }: { readonly text: string; readonly path: string }) {
  const { index } = useVault();
  const html = useMemo(
    () => renderMarkdown(text, { index, from: path, noteHref, fileUrl: vaultService.currentUrl }),
    [text, path, index],
  );
  return <div className="prose-note canvas-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

function NodeBody({ node, path }: { readonly node: CanvasNode; readonly path: string }) {
  if (node.type === "text") return <TextCard text={node.text} path={path} />;
  if (node.type === "file") return <FileCard node={node} />;
  if (node.type === "link") {
    return (
      <a href={node.url} target="_blank" rel="noopener noreferrer" className="text-sm break-all underline">
        {node.url}
      </a>
    );
  }
  return null;
}

function NodeBox({ node, board, path }: { readonly node: CanvasNode; readonly board: Board; readonly path: string }) {
  const color = canvasColor(node.color);
  const group = node.type === "group";
  return (
    <div
      className={`absolute overflow-hidden rounded-lg border ${group ? "border-dashed" : "app-raised p-3 shadow-sm"}`}
      style={{
        left: node.x - board.bounds.x,
        top: node.y - board.bounds.y,
        width: node.width,
        height: node.height,
        borderColor: color ?? "var(--app-line)",
        zIndex: group ? 0 : 1,
      }}
    >
      {group && node.label !== undefined && <p className="app-soft px-3 py-1.5 text-sm font-medium">{node.label}</p>}
      <NodeBody node={node} path={path} />
    </div>
  );
}

function Edges({ board }: { readonly board: Board }) {
  const byId = useMemo(() => new Map(board.nodes.map((n) => [n.id, n])), [board]);
  const { x, y, width, height } = board.bounds;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`${x} ${y} ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10z" fill="var(--app-fg-soft)" />
        </marker>
      </defs>
      {board.edges.map((edge) => {
        const ends = edgeEnds(edge, byId);
        if (ends === null) return null;
        const [a, b] = ends;
        return (
          <g key={edge.id}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={canvasColor(edge.color) ?? "var(--app-fg-soft)"}
              strokeWidth={2}
              markerEnd="url(#canvas-arrow)"
            />
            {edge.label !== undefined && (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 6}
                textAnchor="middle"
                className="fill-[var(--app-fg-soft)] text-xs"
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const MIN_SCALE = 0.45;

function useFitScale(width: number): [React.RefObject<HTMLDivElement | null>, number] {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setScale(Math.max(MIN_SCALE, Math.min(1, entry.contentRect.width / width)));
    });
    if (frame.current !== null) observer.observe(frame.current);
    return () => {
      observer.disconnect();
    };
  }, [width]);
  return [frame, scale];
}

function CanvasBoard({ board, path }: { readonly board: Board; readonly path: string }) {
  const [frame, scale] = useFitScale(board.bounds.width);
  const { width, height } = board.bounds;
  return (
    <div ref={frame} className="app-sidebar -mx-4 overflow-auto rounded-lg border app-line md:mx-0" aria-label="Canvas">
      <div style={{ width: width * scale, height: height * scale }}>
        <div className="relative origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
          <Edges board={board} />
          {board.nodes.map((node) => (
            <NodeBox key={node.id} node={node} board={board} path={path} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CanvasView({ text, path }: { readonly text: string; readonly path: string }) {
  const board = useMemo(() => parseCanvas(text), [text]);
  if (board === null) {
    return <Banner variant="error" title="This canvas could not be read" description="It is not valid JSON Canvas." />;
  }
  return <CanvasBoard board={board} path={path} />;
}
