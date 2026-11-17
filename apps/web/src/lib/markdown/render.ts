import DOMPurify from "dompurify";
import { Marked, type MarkedExtension, type Token } from "marked";

import { extensionOf } from "../file-kind.ts";
import { isExternal, parseWikilink, type LinkIndex, type Wikilink } from "./links.ts";

export interface RenderContext {
  readonly index: LinkIndex;
  readonly from: string;
  readonly noteHref: (vaultPath: string) => string;
  readonly fileUrl: (vaultPath: string) => string;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderWikilink(link: Wikilink, ctx: RenderContext): string {
  const resolved = ctx.index.resolve(link.target, ctx.from);
  const label = escapeHtml(link.label);
  if (resolved === null) return `<a data-missing title="Not in this vault">${label}</a>`;
  if (link.embed && IMAGE_EXTENSIONS.has(extensionOf(resolved))) {
    return `<img src="${escapeHtml(ctx.fileUrl(resolved))}" alt="${label}" loading="lazy">`;
  }
  return `<a href="${escapeHtml(ctx.noteHref(resolved))}">${label}</a>`;
}

function wikilinks(ctx: RenderContext): MarkedExtension {
  return {
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        start: (src) => /!?\[\[/u.exec(src)?.index,
        tokenizer: (src) => {
          const link = parseWikilink(src);
          const raw = /^!?\[\[[^\]\n]+\]\]/u.exec(src)?.[0];
          return link === null || raw === undefined ? undefined : { type: "wikilink", raw };
        },
        renderer: (token) => {
          const raw: unknown = token.raw;
          if (typeof raw !== "string") return false;
          const link = parseWikilink(raw);
          return link === null ? escapeHtml(raw) : renderWikilink(link, ctx);
        },
      },
    ],
  };
}

function resolveHref(href: string, image: boolean, ctx: RenderContext): string | null {
  const [target = "", fragment] = href.split("#", 2);
  const resolved = ctx.index.resolve(target.split("?", 1)[0] ?? "", ctx.from);
  if (resolved === null) return null;
  if (image) return ctx.fileUrl(resolved);
  return fragment === undefined ? ctx.noteHref(resolved) : `${ctx.noteHref(resolved)}#${fragment}`;
}

function relativeLinks(ctx: RenderContext): MarkedExtension {
  return {
    walkTokens: (token: Token) => {
      if (token.type !== "link" && token.type !== "image") return;
      const href: unknown = token.href;
      if (typeof href !== "string" || isExternal(href)) return;
      token.href = resolveHref(href, token.type === "image", ctx) ?? href;
    },
  };
}

export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (!(node instanceof HTMLAnchorElement)) return;
  const href = node.getAttribute("href") ?? "";
  if (isInternalHref(href)) return;
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});

export function renderMarkdown(text: string, ctx: RenderContext): string {
  const marked = new Marked({ gfm: true, async: false }, wikilinks(ctx), relativeLinks(ctx));
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "iframe"],
    FORBID_ATTR: ["style"],
    SANITIZE_NAMED_PROPS: true,
  });
}
