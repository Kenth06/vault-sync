import { CaretRightIcon } from "@phosphor-icons/react";
import type { TreeEntry } from "@vault-sync/protocol";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { noteHref } from "../../lib/routes.ts";
import { ancestorsOf, buildTree, displayName, type FolderNode, type TreeNode } from "../../lib/tree.ts";

interface TreeProps {
  readonly files: readonly TreeEntry[];
  readonly active: string | null;
}

interface LevelProps {
  readonly nodes: readonly TreeNode[];
  readonly depth: number;
  readonly active: string | null;
  readonly open: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
}

interface Choice {
  readonly opened: ReadonlySet<string>;
  readonly closed: ReadonlySet<string>;
}

function toggleMember(set: ReadonlySet<string>, value: string, present: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (present) next.add(value);
  else next.delete(value);
  return next;
}

const ROW = "app-press flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px]";

function indent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${8 + depth * 14}px` };
}

function FolderRow({ node, depth, open, onToggle }: Omit<LevelProps, "nodes" | "active"> & { node: FolderNode }) {
  const expanded = open.has(node.path);
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => {
        onToggle(node.path);
      }}
      className={`${ROW} font-medium hover:app-hover`}
      style={indent(depth)}
    >
      <CaretRightIcon
        size={12}
        weight="bold"
        aria-hidden
        className={`app-soft shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function Level({ nodes, depth, active, open, onToggle }: LevelProps) {
  return (
    <ul role={depth === 0 ? "tree" : "group"} className="flex flex-col gap-px">
      {nodes.map((node) => (
        <li key={node.path} role="treeitem" aria-selected={node.path === active}>
          {node.kind === "folder" ? (
            <>
              <FolderRow node={node} depth={depth} open={open} onToggle={onToggle} />
              {open.has(node.path) && (
                <Level nodes={node.children} depth={depth + 1} active={active} open={open} onToggle={onToggle} />
              )}
            </>
          ) : (
            <Link
              to={noteHref(node.path)}
              aria-current={node.path === active ? "page" : undefined}
              className={`${ROW} ${node.path === active ? "app-selected font-medium" : "hover:app-hover"}`}
              style={{ paddingLeft: `${8 + depth * 14 + 18}px` }}
            >
              <span className="truncate">{displayName(node.path)}</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FileTree({ files, active }: TreeProps) {
  const nodes = useMemo(() => buildTree(files), [files]);
  const [choice, setChoice] = useState<Choice>({ opened: new Set(), closed: new Set() });
  const open = useMemo(() => {
    const around = active === null ? [] : ancestorsOf(active).filter((folder) => !choice.closed.has(folder));
    return new Set([...choice.opened, ...around]);
  }, [choice, active]);

  const onToggle = (path: string) => {
    const closing = open.has(path);
    setChoice((prev) => ({
      opened: toggleMember(prev.opened, path, !closing),
      closed: toggleMember(prev.closed, path, closing),
    }));
  };

  return <Level nodes={nodes} depth={0} active={active} open={open} onToggle={onToggle} />;
}
