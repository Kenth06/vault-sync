import DOMPurify from "dompurify";
import GithubSlugger from "github-slugger";
import { Marked, type MarkedExtension, type Token } from "marked";
import markedFootnote from "marked-footnote";

import { escapeHtml, type LinkContext } from "./embed.ts";
import { pdfFrameSource } from "./frame.ts";
import { isExternal } from "./links.ts";
import { obsidianSyntax } from "./obsidian.ts";

export type RenderContext = LinkContext;

const USER_PREFIX = "user-content-";

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

function blocks(): MarkedExtension {
  const slugger = new GithubSlugger();
  return {
    renderer: {
      heading({ tokens, depth, text }) {
        return `<h${depth} id="${slugger.slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang ?? "").split(/\s/u, 1)[0] ?? "";
        if (language === "mermaid") return `<div class="mermaid-block">${escapeHtml(text)}</div>\n`;
        const className = language === "" ? "" : ` class="language-${escapeHtml(language)}"`;
        return `<pre><code${className}>${escapeHtml(text)}</code></pre>\n`;
      },
    },
  };
}

export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe" || !(node instanceof Element)) return;
  const safe = pdfFrameSource(node.getAttribute("src") ?? "", location.origin);
  if (safe === null) node.remove();
  else node.setAttribute("src", safe);
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (!(node instanceof HTMLAnchorElement)) return;
  const href = node.getAttribute("href") ?? "";
  if (href.startsWith("#") && !href.startsWith(`#${USER_PREFIX}`) && href.length > 1) {
    node.setAttribute("href", `#${USER_PREFIX}${href.slice(1)}`);
  }
  if (href === "" || href.startsWith("#") || isInternalHref(href)) return;
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});

export function renderMarkdown(text: string, ctx: RenderContext): string {
  const marked = new Marked(
    { gfm: true, async: false },
    blocks(),
    obsidianSyntax(ctx),
    markedFootnote({ description: "Footnotes" }),
    relativeLinks(ctx),
  );
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    FORBID_TAGS: ["style", "form"],
    FORBID_ATTR: ["style"],
    SANITIZE_NAMED_PROPS: true,
  });
}
