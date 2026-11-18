import { Banner, Empty } from "@cloudflare/kumo";
import { DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react";
import type { Sha256 } from "@vault-sync/protocol";
import { useEffect, useRef } from "react";

import { useAsync } from "../../lib/client/hooks/useAsync.ts";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { extensionOf, fileKind, type FileKind } from "../../lib/file-kind.ts";
import { formatBytes } from "../../lib/format.ts";
import { enhance } from "../../lib/markdown/enhance.ts";
import { LinkButton } from "../ui/LinkButton.tsx";
import { CanvasView } from "./CanvasView.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { NoteSkeleton } from "./NoteSkeleton.tsx";

export type FileSource = { readonly kind: "current" } | { readonly kind: "blob"; readonly hash: Sha256 };

interface FileContentProps {
  readonly path: string;
  readonly size: number;
  readonly source: FileSource;
  readonly revision: number;
}

type TextKind = Extract<FileKind, "markdown" | "canvas" | "code">;

const FRAME = "rounded-md outline outline-1 -outline-offset-1 outline-[var(--app-outline)]";

export function fileUrl(path: string, source: FileSource): string {
  return source.kind === "current" ? vaultService.currentUrl(path) : vaultService.blobUrl(source.hash, path);
}

function CodeView({ text, path }: { readonly text: string; readonly path: string }) {
  const code = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (code.current !== null && text !== "") void enhance(code.current);
  }, [text]);
  return (
    <pre ref={code} className="app-raised overflow-x-auto rounded-lg p-4 font-mono text-[13px] leading-relaxed">
      <code className={`language-${extensionOf(path)}`}>{text}</code>
    </pre>
  );
}

function TextFile({ path, source, revision, kind }: Omit<FileContentProps, "size"> & { kind: TextKind }) {
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
  if (kind === "markdown") return <MarkdownBody text={text.data} path={path} />;
  if (kind === "canvas") return <CanvasView text={text.data} path={path} />;
  return <CodeView key={key} text={text.data} path={path} />;
}

function NoPreview({ url, size }: { readonly url: string; readonly size: number }) {
  return (
    <Empty
      icon={<FileIcon size={40} aria-hidden />}
      title="No preview for this file type"
      description={`${formatBytes(size)}. Download it to open it on this device.`}
      contents={
        <LinkButton href={url} icon={DownloadSimpleIcon} variant="primary" download>
          Download
        </LinkButton>
      }
    />
  );
}

function MediaView({ kind, url, path }: { readonly kind: FileKind; readonly url: string; readonly path: string }) {
  if (kind === "image")
    return <img src={url} alt={path} className={`max-h-[75dvh] max-w-full object-contain ${FRAME}`} />;
  if (kind === "audio") {
    return (
      <audio controls preload="metadata" src={url} className="w-full">
        <track kind="captions" />
      </audio>
    );
  }
  if (kind === "video") {
    return (
      <video controls preload="metadata" src={url} className={`max-h-[75dvh] w-full bg-black ${FRAME}`}>
        <track kind="captions" />
      </video>
    );
  }
  // oxlint-disable-next-line react/iframe-missing-sandbox
  return <iframe src={url} title={path} className={`h-[80dvh] w-full ${FRAME}`} />;
}

export function FileContent(props: FileContentProps) {
  const kind = fileKind(props.path, props.size);
  const url = fileUrl(props.path, props.source);
  if (kind === "markdown" || kind === "canvas" || kind === "code") return <TextFile {...props} kind={kind} />;
  if (kind === "other") return <NoPreview url={url} size={props.size} />;
  return <MediaView kind={kind} url={url} path={props.path} />;
}
