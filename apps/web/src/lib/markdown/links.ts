export interface Wikilink {
  readonly embed: boolean;
  readonly target: string;
  readonly heading: string | null;
  readonly label: string;
}

export interface Frontmatter {
  readonly properties: ReadonlyArray<readonly [string, string]>;
  readonly body: string;
}

const WIKILINK = /^(!?)\[\[([^\]\n]+)\]\]/u;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

function stem(vaultPath: string): string {
  return vaultPath.toLocaleLowerCase().replace(/\.md$/u, "");
}

function basename(vaultPath: string): string {
  return vaultPath.slice(vaultPath.lastIndexOf("/") + 1);
}

function labelFor(target: string, heading: string | undefined, alias: string | undefined): string {
  if (alias !== undefined) return alias.trim();
  if (target === "") return heading?.trim() ?? "";
  return basename(target).replace(/\.md$/u, "");
}

export function parseWikilink(raw: string): Wikilink | null {
  const match = WIKILINK.exec(raw);
  if (match === null) return null;
  const [, bang = "", inner = ""] = match;
  const [link = "", alias] = inner.split("|", 2);
  const [target = "", heading] = link.split("#", 2);
  const name = target.trim();
  return { embed: bang === "!", target: name, heading: heading?.trim() ?? null, label: labelFor(name, heading, alias) };
}

export class LinkIndex {
  private readonly byPath = new Map<string, string>();
  private readonly byName = new Map<string, string>();

  constructor(paths: readonly string[]) {
    const shortestFirst = paths.toSorted((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
    for (const vaultPath of shortestFirst) {
      this.byPath.set(stem(vaultPath), vaultPath);
      const name = stem(basename(vaultPath));
      if (!this.byName.has(name)) this.byName.set(name, vaultPath);
    }
  }

  resolve(target: string, from: string): string | null {
    const clean = decodeSafely(target).replace(/^\.\//u, "").replace(/^\//u, "");
    if (clean === "") return null;
    const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    const key = stem(clean);
    return (
      this.byPath.get(stem(folder + clean)) ?? this.byPath.get(key) ?? this.byName.get(stem(basename(key))) ?? null
    );
  }
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function splitFrontmatter(text: string): Frontmatter {
  const match = FRONTMATTER.exec(text);
  if (match === null) return { properties: [], body: text };
  const properties = (match[1] ?? "")
    .split(/\r?\n/u)
    .map((line) => /^([^:\s][^:]*):\s*(.*)$/u.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m): readonly [string, string] => [m[1] ?? "", (m[2] ?? "").replaceAll(/^["']|["']$/gu, "")]);
  return { properties, body: text.slice(match[0].length) };
}

export function withoutLeadingTitle(body: string, title: string): string {
  const match = /^\s*# +(.+?)[\t #]*(?:\r?\n|$)/u.exec(body);
  const heading = match?.[1]?.trim().toLocaleLowerCase();
  return match !== null && heading === title.toLocaleLowerCase() ? body.slice(match[0].length) : body;
}

export function isExternal(href: string): boolean {
  return /^[a-z][\d+.a-z-]*:/iu.test(href) || href.startsWith("#") || href.startsWith("//");
}
