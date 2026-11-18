import type { MarkedExtension, TokenizerAndRendererExtension } from "marked";

import { escapeHtml, renderWikilink, type LinkContext } from "./embed.ts";
import { parseWikilink } from "./links.ts";

const CALLOUT_HEAD = /^ {0,3}> ?\[!([\w-]+)\]([+-]?)[\t ]*(.*)$/u;
const QUOTE_BLOCK = /^(?: {0,3}>[^\n]*(?:\n|$))+/u;
const QUOTE_PREFIX = /^ {0,3}> ?/u;

function rawOf(token: { raw: string }): string {
  return token.raw;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const callout: TokenizerAndRendererExtension = {
  name: "callout",
  level: "block",
  start: (src) => /^ {0,3}> ?\[!/mu.exec(src)?.index,
  tokenizer(src) {
    const block = [QUOTE_BLOCK.exec(src)?.[0]].find(
      (b) => b !== undefined && CALLOUT_HEAD.test(b.split("\n", 1)[0] ?? ""),
    );
    if (block === undefined) return block;
    const body = block
      .split("\n")
      .slice(1)
      .map((line) => line.replace(QUOTE_PREFIX, ""))
      .join("\n");
    return { type: "callout", raw: block, tokens: this.lexer.blockTokens(body, []) };
  },
  renderer(token) {
    const [, kind = "note", fold = "", title = ""] = CALLOUT_HEAD.exec(rawOf(token).split("\n", 1)[0] ?? "") ?? [];
    const name = kind.toLowerCase();
    const heading = escapeHtml(title === "" ? titleCase(name) : title);
    const inner = this.parser.parse(token.tokens ?? []);
    if (fold === "") {
      return `<div class="callout" data-callout="${escapeHtml(name)}"><p class="callout-title">${heading}</p><div class="callout-content">${inner}</div></div>`;
    }
    const open = fold === "+" ? " open" : "";
    return `<details class="callout" data-callout="${escapeHtml(name)}"${open}><summary class="callout-title">${heading}</summary><div class="callout-content">${inner}</div></details>`;
  },
};

const blockComment: TokenizerAndRendererExtension = {
  name: "blockComment",
  level: "block",
  start: (src) => /^%%/mu.exec(src)?.index,
  tokenizer: (src) => {
    const raw = /^%%[\s\S]*?%%[\t ]*(?:\n|$)/u.exec(src)?.[0];
    return raw === undefined ? raw : { type: "blockComment", raw };
  },
  renderer: () => "",
};

const inlineComment: TokenizerAndRendererExtension = {
  name: "inlineComment",
  level: "inline",
  start: (src) => (src.includes("%%") ? src.indexOf("%%") : undefined),
  tokenizer: (src) => {
    const raw = /^%%[^\n]*?%%/u.exec(src)?.[0];
    return raw === undefined ? raw : { type: "inlineComment", raw };
  },
  renderer: () => "",
};

const highlight: TokenizerAndRendererExtension = {
  name: "highlight",
  level: "inline",
  start: (src) => (src.includes("==") ? src.indexOf("==") : undefined),
  tokenizer(src) {
    const [raw, inner = ""] = /^==(?=\S)([^\n]*?\S)==/u.exec(src) ?? [];
    return raw === undefined ? raw : { type: "highlight", raw, tokens: this.lexer.inlineTokens(inner) };
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
  },
};

const TAG = /^#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/u;

const tag: TokenizerAndRendererExtension = {
  name: "tag",
  level: "inline",
  start: (src) => {
    const at = src.search(/(?:^|\s)#[\p{L}\p{N}_/-]*\p{L}/u);
    return at < 0 ? undefined : at + (src[at] === "#" ? 0 : 1);
  },
  tokenizer: (src) => {
    const raw = TAG.exec(src)?.[0];
    return raw === undefined ? raw : { type: "tag", raw };
  },
  renderer: (token) => `<span class="tag">${escapeHtml(rawOf(token))}</span>`,
};

const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start: (src) => /^\$\$/mu.exec(src)?.index,
  tokenizer: (src) => {
    const raw = /^\$\$([\s\S]+?)\$\$[\t ]*(?:\n|$)/u.exec(src)?.[0];
    return raw === undefined ? raw : { type: "blockMath", raw };
  },
  renderer: (token) => `<div class="math-block">${escapeHtml(rawOf(token).trim().slice(2, -2).trim())}</div>`,
};

const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start: (src) => (src.includes("$") ? src.indexOf("$") : undefined),
  tokenizer: (src) => {
    const raw = /^\$(?![\s$])[^\n$]+?(?<!\s)\$(?!\d)/u.exec(src)?.[0];
    return raw === undefined ? raw : { type: "inlineMath", raw };
  },
  renderer: (token) => `<span class="math-inline">${escapeHtml(rawOf(token).slice(1, -1))}</span>`,
};

function wikilink(ctx: LinkContext): TokenizerAndRendererExtension {
  return {
    name: "wikilink",
    level: "inline",
    start: (src) => /!?\[\[/u.exec(src)?.index,
    tokenizer: (src) => {
      const raw = /^!?\[\[[^\]\n]+\]\]/u.exec(src)?.[0];
      return raw === undefined ? raw : { type: "wikilink", raw };
    },
    renderer: (token) => {
      const link = parseWikilink(rawOf(token));
      return link === null ? escapeHtml(rawOf(token)) : renderWikilink(link, ctx);
    },
  };
}

export function obsidianSyntax(ctx: LinkContext): MarkedExtension {
  return {
    extensions: [callout, blockComment, blockMath, inlineComment, highlight, inlineMath, tag, wikilink(ctx)],
  };
}
