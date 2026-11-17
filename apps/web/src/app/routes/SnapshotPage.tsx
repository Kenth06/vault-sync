import { Banner, Input, Loader } from "@cloudflare/kumo";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageBar } from "../../components/layout/PageBar.tsx";
import { FileContent } from "../../components/vault/FileContent.tsx";
import { useAsync } from "../../lib/client/hooks/useAsync.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { formatBytes, formatCount } from "../../lib/format.ts";
import { snapshotFileHref, snapshotHref } from "../../lib/routes.ts";
import { displayName, filterFiles } from "../../lib/tree.ts";

const MAX_ROWS = 500;

function useSnapshotTree(seq: number) {
  return useAsync((signal) => vaultService.snapshotTree(seq, signal), `snapshot:${seq}`);
}

export function SnapshotPage() {
  const seq = Number(useParams().seq);
  const tree = useSnapshotTree(seq);
  const [query, setQuery] = useState("");
  const files = filterFiles(tree.data?.files ?? [], query);
  return (
    <>
      <PageBar crumbs={["Snapshots", `#${seq}`]} back={{ to: "/snapshots", label: "Snapshots" }} />
      <section className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:px-10 md:pt-14">
        <h1 className="text-xl font-semibold tracking-[-0.01em] tabular-nums">Snapshot #{seq}</h1>
        <p className="app-soft mt-1 mb-6 text-sm tabular-nums">
          {tree.data === null ? "Loading…" : formatCount(tree.data.files.length, "file")}
        </p>
        <Input
          type="search"
          aria-label="Search this snapshot"
          placeholder="Search this snapshot"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="mb-4 w-full min-w-0"
        />
        {tree.error !== null && (
          <Banner variant="error" title="Could not open the snapshot" description={tree.error.message} />
        )}
        {tree.data === null && tree.error === null && <Loader size="sm" />}
        <ul className="divide-y divide-[var(--app-line)]">
          {files.slice(0, MAX_ROWS).map((file) => (
            <li key={file.path}>
              <Link
                to={snapshotFileHref(seq, file.path)}
                className="app-press -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2.5 hover:app-hover"
              >
                <span className="truncate text-sm">{file.path}</span>
                <span className="app-soft shrink-0 text-xs tabular-nums">{formatBytes(file.size)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function SnapshotFilePage() {
  const params = useParams();
  const seq = Number(params.seq);
  const path = params["*"] ?? "";
  const tree = useSnapshotTree(seq);
  const entry = tree.data?.files.find((f) => f.path === path);
  return (
    <>
      <PageBar
        crumbs={[`Snapshot #${seq}`, ...path.split("/")]}
        back={{ to: snapshotHref(seq), label: `Snapshot #${seq}` }}
      />
      <article className="px-4 pt-10 pb-24 md:px-10">
        <div className="mx-auto max-w-[68ch]">
          <h1 className="mb-8 text-[1.875rem] leading-tight font-[650] tracking-[-0.015em] break-words">
            {displayName(path)}
          </h1>
          {tree.error !== null && (
            <Banner variant="error" title="Could not open the snapshot" description={tree.error.message} />
          )}
          {tree.data !== null && entry === undefined && (
            <p className="app-soft text-sm">This snapshot has no file at {path}.</p>
          )}
          {entry !== undefined && (
            <FileContent path={path} size={entry.size} source={{ kind: "blob", hash: entry.hash }} revision={0} />
          )}
        </div>
      </article>
    </>
  );
}
