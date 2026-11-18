import { slug } from "github-slugger";

import { mediaKind, type FileKind } from "../file-kind.ts";
import type { LinkIndex, Wikilink } from "./links.ts";

export interface LinkContext {
  readonly index: LinkIndex;
  readonly from: string;
  readonly noteHref: (vaultPath: string) => string;
  readonly fileUrl: (vaultPath: string) => string;
}

const SIZE = /^(\d{1,4})(?:x(\d{1,4}))?$/u;

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function headingAnchor(heading: string): string {
  return `#user-content-${slug(heading)}`;
}

function sizeAttrs(label: string): string {
  const match = SIZE.exec(label);
  if (match === null) return "";
  const [, width = "", height] = match;
  return height === undefined ? ` width="${width}"` : ` width="${width}" height="${height}"`;
}

type EmbedRenderer = (src: string, label: string, raw: string) => string;

const EMBEDS: Partial<Record<FileKind, EmbedRenderer>> = {
  image: (src, label, raw) => `<img src="${src}" alt="${SIZE.test(raw) ? "" : label}"${sizeAttrs(raw)} loading="lazy">`,
  audio: (src) => `<audio controls preload="metadata" src="${src}"></audio>`,
  video: (src) => `<video controls preload="metadata" src="${src}"></video>`,
  pdf: (src, label) => `<iframe class="pdf-embed" src="${src}" title="${label}"></iframe>`,
};

function media(resolved: string, link: Wikilink, ctx: LinkContext): string | null {
  const kind = mediaKind(resolved);
  const render = kind === null ? undefined : EMBEDS[kind];
  if (render === undefined) return null;
  return render(escapeHtml(ctx.fileUrl(resolved)), escapeHtml(link.label), link.label);
}

function noteLink(resolved: string, link: Wikilink, ctx: LinkContext): string {
  const anchor = link.heading === null ? "" : headingAnchor(link.heading);
  const href = escapeHtml(`${ctx.noteHref(resolved)}${anchor}`);
  const className = link.embed ? ' class="embed-link"' : "";
  return `<a href="${href}"${className}>${escapeHtml(link.label)}</a>`;
}

export function renderWikilink(link: Wikilink, ctx: LinkContext): string {
  if (link.target === "" && link.heading !== null) {
    return `<a href="${escapeHtml(headingAnchor(link.heading))}">${escapeHtml(link.label)}</a>`;
  }
  const resolved = ctx.index.resolve(link.target, ctx.from);
  if (resolved === null) return `<a data-missing title="Not in this vault">${escapeHtml(link.label)}</a>`;
  return (link.embed ? media(resolved, link, ctx) : null) ?? noteLink(resolved, link, ctx);
}
