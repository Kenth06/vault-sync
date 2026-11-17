import { Banner, Empty } from "@cloudflare/kumo";
import { DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react";
import type { Sha256 } from "@vault-sync/protocol";

import { useAsync } from "../../lib/client/hooks/useAsync.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { fileKind } from "../../lib/file-kind.ts";
import { formatBytes } from "../../lib/format.ts";
import { LinkButton } from "../ui/LinkButton.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { NoteSkeleton } from "./NoteSkeleton.tsx";

export type FileSource = { readonly kind: "current" } | { readonly kind: "blob"; readonly hash: Sha256 };

interface FileContentProps {
  readonly path: string;
  readonly size: number;
  readonly source: FileSource;
  readonly revision: number;
}

export function fileUrl(path: string, source: FileSource): string {
  return source.kind === "current" ? vaultService.currentUrl(path) : vaultService.blobUrl(source.hash, path);
}

function TextFile({ path, source, revision, markdown }: Omit<FileContentProps, "size"> & { markdown: boolean }) {
  const key = source.kind === "current" ? `current:${path}` : `blob:${source.hash}`;
  const text = useAsync(
    (signal) =>
      source.kind === "current" ? vaultService.currentText(path, signal) : vaultService.blobText(source.hash, signal),
    key,
    source.kind === "current" ? revision : 0,
  );
  if (text.error !== null) {
    return <Banner variant="error" title="Could not open this file" description={text.error.message} />;
  }
  if (text.data === null) return <NoteSkeleton />;
  if (markdown) return <MarkdownBody text={text.data} path={path} />;
  return (
    <pre className="app-raised overflow-x-auto rounded-lg p-4 font-mono text-[13px] leading-relaxed">{text.data}</pre>
  );
}

export function FileContent(props: FileContentProps) {
  const kind = fileKind(props.path, props.size);
  const url = fileUrl(props.path, props.source);
  if (kind === "markdown" || kind === "text") return <TextFile {...props} markdown={kind === "markdown"} />;
  if (kind === "image") {
    return (
      <img
        src={url}
        alt={props.path}
        className="max-h-[75dvh] max-w-full rounded-md object-contain outline outline-1 -outline-offset-1 outline-[var(--app-outline)]"
      />
    );
  }
  return (
    <Empty
      icon={<FileIcon size={40} aria-hidden />}
      title="No preview for this file type"
      description={`${formatBytes(props.size)}. Download it to open it on this device.`}
      contents={
        <LinkButton href={url} icon={DownloadSimpleIcon} variant="primary" download>
          Download
        </LinkButton>
      }
    />
  );
}
