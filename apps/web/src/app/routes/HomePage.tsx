import { Banner, Empty } from "@cloudflare/kumo";
import { ArrowsLeftRightIcon, PencilSimpleIcon, TrashIcon, type Icon } from "@phosphor-icons/react";
import type { ChangeRow } from "@vault-sync/protocol";
import { Link } from "react-router";

import { Sidebar } from "../../components/layout/AppShell.tsx";
import { useVault } from "../../contexts/VaultContext.tsx";
import { useAsync } from "../../lib/client/hooks/useAsync.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { formatAgo } from "../../lib/format.ts";
import { noteHref } from "../../lib/routes.ts";
import { displayName } from "../../lib/tree.ts";

const OP_ICON: Readonly<Record<ChangeRow["op"], Icon>> = {
  put: PencilSimpleIcon,
  rename: ArrowsLeftRightIcon,
  delete: TrashIcon,
};

function verb(row: ChangeRow): string {
  if (row.op === "delete") return "Deleted";
  if (row.op === "rename") return `Renamed from ${displayName(row.fromPath ?? "")}`;
  return row.prevHash === null ? "Created" : "Edited";
}

function ChangeItem({ row }: { readonly row: ChangeRow }) {
  const { byPath, deviceName } = useVault();
  const OpIcon = OP_ICON[row.op];
  const exists = row.op !== "delete" && byPath.has(row.path);
  const name = <span className="truncate text-sm font-medium">{displayName(row.path)}</span>;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <OpIcon size={16} aria-hidden className="app-soft shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        {exists ? (
          <Link to={noteHref(row.path)} className="truncate hover:underline hover:underline-offset-2">
            {name}
          </Link>
        ) : (
          name
        )}
        <span className="app-soft truncate text-xs">
          {verb(row)} on {deviceName(row.deviceId)}
        </span>
      </div>
      <span className="app-soft shrink-0 text-xs tabular-nums">{formatAgo(row.at)}</span>
    </li>
  );
}

function RecentChanges() {
  const { status, revision } = useVault();
  const cursor = status?.cursor ?? null;
  const changes = useAsync(
    (signal) => vaultService.recentChanges(cursor ?? 0, signal),
    cursor === null ? "waiting" : "changes",
    revision,
  );
  if (changes.error !== null) {
    return <Banner variant="error" title="Could not load recent changes" description={changes.error.message} />;
  }
  if (changes.data === null) return <p className="app-soft py-3 text-sm">Loading recent changes…</p>;
  if (changes.data.length === 0) {
    return (
      <Empty
        title="Nothing synced yet"
        description="Run the CLI or the Obsidian plugin on the PC that holds the vault."
      />
    );
  }
  return (
    <ol className="divide-y divide-[var(--app-line)]">
      {changes.data.toReversed().map((row) => (
        <ChangeItem key={row.seq} row={row} />
      ))}
    </ol>
  );
}

export function HomePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="app-sidebar flex flex-col border-b app-line md:hidden">
        <Sidebar />
      </div>
      <section className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:px-10 md:pt-14">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Recent changes</h1>
        <p className="app-soft mt-1 mb-4 text-sm">The last 30 changes from every device, newest first.</p>
        <RecentChanges />
      </section>
    </div>
  );
}
