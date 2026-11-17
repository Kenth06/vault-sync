import { Banner, Loader } from "@cloudflare/kumo";
import type { ChangeRow } from "@vault-sync/protocol";
import { Link } from "react-router";

import { useVault } from "../../contexts/VaultContext.tsx";
import { formatAgo, formatBytes, formatDate } from "../../lib/format.ts";
import { displayName } from "../../lib/tree.ts";

interface HistoryPanelProps {
  readonly path: string;
  readonly rows: readonly ChangeRow[] | null;
  readonly error: Error | null;
  readonly selected: number | null;
}

function title(row: ChangeRow, path: string, isLatest: boolean): string {
  if (row.op === "delete") return "Deleted";
  if (row.op === "rename" && row.fromPath === path) return `Renamed to ${displayName(row.path)}`;
  if (row.op === "rename") return `Renamed from ${displayName(row.fromPath ?? "")}`;
  return isLatest ? "Current version" : formatDate(row.at);
}

function viewable(row: ChangeRow, path: string): boolean {
  return row.hash !== null && row.path === path;
}

function Row({ row, path, latest, selected }: { row: ChangeRow; path: string; latest: boolean; selected: boolean }) {
  const { deviceName } = useVault();
  const detail = [
    deviceName(row.deviceId),
    latest ? formatAgo(row.at) : null,
    row.size === null ? null : formatBytes(row.size),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] font-medium">{title(row, path, latest)}</span>
        <span className="app-soft shrink-0 font-mono text-xs tabular-nums">#{row.seq}</span>
      </span>
      <span className="app-soft truncate text-xs tabular-nums">{detail}</span>
    </>
  );
  const base = "flex flex-col gap-0.5 rounded-md px-2.5 py-2";
  if (!viewable(row, path)) return <div className={`${base} opacity-70`}>{body}</div>;
  return (
    <Link
      to={latest ? "?history" : `?history&v=${row.seq}`}
      aria-current={selected ? "true" : undefined}
      className={`app-press ${base} ${selected ? "app-selected" : "hover:app-hover"}`}
    >
      {body}
    </Link>
  );
}

export function HistoryPanel({ path, rows, error, selected }: HistoryPanelProps) {
  if (error !== null) return <Banner variant="error" title="Could not load the history" description={error.message} />;
  if (rows === null) return <Loader size="sm" className="m-4" />;
  const latestSeq = rows.find((r) => viewable(r, path))?.seq;
  return (
    <ol aria-label="Versions" className="flex flex-col gap-px">
      {rows.map((row) => (
        <li key={row.seq}>
          <Row
            row={row}
            path={path}
            latest={row.seq === latestSeq}
            selected={selected === null ? row.seq === latestSeq : selected === row.seq}
          />
        </li>
      ))}
    </ol>
  );
}
