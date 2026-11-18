import { Banner, Empty } from "@cloudflare/kumo";
import { ClockCounterClockwiseIcon, DownloadSimpleIcon, FileXIcon } from "@phosphor-icons/react";
import type { ChangeRow, TreeEntry } from "@vault-sync/protocol";
import { Link, useParams, useSearchParams } from "react-router";

import { PageBar } from "../../components/layout/PageBar.tsx";
import { LinkButton } from "../../components/ui/LinkButton.tsx";
import { FileContent, fileUrl, type FileSource } from "../../components/vault/FileContent.tsx";
import { HistoryPanel } from "../../components/vault/HistoryPanel.tsx";
import { useVault } from "../../contexts/VaultContext.tsx";
import { useAsync } from "../../lib/client/hooks/useAsync.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { contentWidth } from "../../lib/file-kind.ts";
import { formatBytes, formatFullDate } from "../../lib/format.ts";
import { displayName } from "../../lib/tree.ts";

function versionFrom(rows: readonly ChangeRow[] | null, seq: number | null): ChangeRow | null {
  if (rows === null || seq === null) return null;
  return rows.find((r) => r.seq === seq && r.hash !== null) ?? null;
}

function NoteHeader({ entry, version }: { readonly entry: TreeEntry; readonly version: ChangeRow | null }) {
  const { deviceName } = useVault();
  const at = version?.at ?? entry.mtime;
  const by = version === null ? "" : ` on ${deviceName(version.deviceId)}`;
  return (
    <div className="mb-8 flex flex-col gap-2">
      <h1 className="text-[1.875rem] leading-tight font-[650] tracking-[-0.015em] break-words">
        {displayName(entry.path)}
      </h1>
      <p className="app-soft text-[13px] tabular-nums">
        {version === null ? "Edited" : "Saved"} {formatFullDate(at)}
        {by} · {formatBytes(version?.size ?? entry.size)}
      </p>
    </div>
  );
}

function useVersion(path: string, revision: number) {
  const [params] = useSearchParams();
  const raw = params.get("v");
  const history = useAsync((signal) => vaultService.history(path, signal), `history:${path}`, revision);
  const version = versionFrom(history.data, raw === null ? null : Number(raw));
  const source: FileSource = version?.hash == null ? { kind: "current" } : { kind: "blob", hash: version.hash };
  return { history, version, source, showHistory: params.has("history") };
}

function FileView({ entry }: { readonly entry: TreeEntry }) {
  const { revision } = useVault();
  const { history, version, source, showHistory } = useVersion(entry.path, revision);

  return (
    <>
      <PageBar
        crumbs={entry.path.split("/")}
        actions={
          <>
            <LinkButton
              route
              href={showHistory ? "?" : "?history"}
              icon={ClockCounterClockwiseIcon}
              variant={showHistory ? "pressed" : "ghost"}
            >
              History
            </LinkButton>
            <LinkButton href={fileUrl(entry.path, source)} icon={DownloadSimpleIcon} download>
              <span className="max-sm:sr-only">Download</span>
            </LinkButton>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <article className="min-w-0 flex-1 px-4 pt-10 pb-24 md:px-10">
          <div className={`mx-auto ${contentWidth(entry.path)}`}>
            {version !== null && (
              <Banner
                variant="secondary"
                className="mb-6"
                title={`Version #${version.seq}, read-only`}
                description={
                  <Link to="?history" className="underline underline-offset-2">
                    Back to the current version
                  </Link>
                }
              />
            )}
            <NoteHeader entry={entry} version={version} />
            <FileContent path={entry.path} size={version?.size ?? entry.size} source={source} revision={revision} />
          </div>
        </article>
        {showHistory && (
          <aside
            aria-label="History"
            className="app-line shrink-0 p-2 max-lg:order-first max-lg:border-b lg:w-75 lg:border-l"
          >
            <h2 className="px-2.5 pt-2 pb-2 text-[13px] font-semibold">History</h2>
            <HistoryPanel path={entry.path} rows={history.data} error={history.error} selected={version?.seq ?? null} />
          </aside>
        )}
      </div>
    </>
  );
}

export function FilePage() {
  const path = useParams()["*"] ?? "";
  const { byPath, loading } = useVault();
  const entry = byPath.get(path);
  if (entry !== undefined) return <FileView key={path} entry={entry} />;
  if (loading) return <PageBar crumbs={path.split("/")} />;
  return (
    <>
      <PageBar crumbs={path.split("/")} />
      <Empty
        className="mt-16"
        icon={<FileXIcon size={40} aria-hidden />}
        title="This file is not in the vault"
        description="It may have been renamed or deleted. Its old versions are still in a snapshot."
        contents={
          <Link to="/snapshots" className="text-sm font-medium underline underline-offset-2">
            Browse snapshots
          </Link>
        }
      />
    </>
  );
}
