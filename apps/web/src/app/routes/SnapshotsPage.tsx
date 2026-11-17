import { Banner, Button, Empty, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { ArchiveIcon, CameraIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router";

import { PageBar } from "../../components/layout/PageBar.tsx";
import { useVault } from "../../contexts/VaultContext.tsx";
import { useAsync } from "../../lib/client/hooks/useAsync.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { formatBytes, formatCount, formatFullDate } from "../../lib/format.ts";
import { snapshotHref } from "../../lib/routes.ts";

function TakeSnapshot({ onTaken }: { readonly onTaken: () => void }) {
  const toasts = useKumoToastManager();
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    try {
      const snapshot = await vaultService.createSnapshot();
      toasts.add({
        title: snapshot === null ? "Nothing changed since the last snapshot" : `Snapshot #${snapshot.seq} saved`,
      });
      onTaken();
    } catch (error) {
      toasts.add({ title: "Could not take a snapshot", description: String(error), variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="secondary" icon={CameraIcon} loading={busy} onClick={() => void take()}>
      Take snapshot
    </Button>
  );
}

export function SnapshotsPage() {
  const { revision } = useVault();
  const snapshots = useAsync((signal) => vaultService.snapshots(signal), "snapshots", revision);
  return (
    <>
      <PageBar crumbs={["Snapshots"]} actions={<TakeSnapshot onTaken={snapshots.refresh} />} />
      <section className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:px-10 md:pt-14">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Snapshots</h1>
        <p className="app-soft mt-1 mb-6 text-sm text-pretty">
          The whole vault as it was at one moment. Taken every day there are changes. Restore one with the CLI:{" "}
          <code className="font-mono text-xs">restore &lt;dir&gt; --snapshot &lt;seq&gt;</code>.
        </p>
        {snapshots.error !== null && (
          <Banner variant="error" title="Could not load snapshots" description={snapshots.error.message} />
        )}
        {snapshots.data === null && snapshots.error === null && <Loader size="sm" />}
        {snapshots.data?.length === 0 && (
          <Empty
            icon={<ArchiveIcon size={40} aria-hidden />}
            title="No snapshots yet"
            description="The first one is taken a day after the first sync, or now with Take snapshot."
          />
        )}
        <ol className="divide-y divide-[var(--app-line)]">
          {(snapshots.data ?? []).map((s) => (
            <li key={s.seq}>
              <Link
                to={snapshotHref(s.seq)}
                className="app-press -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3 hover:app-hover"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium tabular-nums">{formatFullDate(s.at)}</span>
                  <span className="app-soft text-xs tabular-nums">
                    {formatCount(s.files, "file")} · {formatBytes(s.bytes)}
                  </span>
                </span>
                <span className="app-soft font-mono text-xs tabular-nums">#{s.seq}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
