import DOMPurify from "dompurify";

const MERMAID_SVG = { USE_PROFILES: { svg: true, svgFilters: true } };

function isDark(): boolean {
  return document.documentElement.dataset.mode === "dark";
}

async function renderMath(root: HTMLElement): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>(".math-inline, .math-block")];
  if (nodes.length === 0) return;
  const [{ default: katex }] = await Promise.all([import("katex"), import("katex/dist/katex.min.css")]);
  for (const node of nodes) {
    katex.render(node.textContent, node, {
      displayMode: node.classList.contains("math-block"),
      throwOnError: false,
    });
  }
}

async function renderDiagrams(root: HTMLElement): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>(".mermaid-block")];
  if (nodes.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark() ? "dark" : "neutral",
    htmlLabels: false,
  });
  const rendered = await Promise.all(
    nodes.map(async (node, i) => {
      try {
        return (await mermaid.render(`mermaid-${crypto.randomUUID()}-${i}`, node.textContent)).svg;
      } catch {
        return null;
      }
    }),
  );
  for (const [i, svg] of rendered.entries()) {
    const node = nodes[i];
    if (node === undefined || svg === null) continue;
    node.innerHTML = DOMPurify.sanitize(svg, MERMAID_SVG);
    node.classList.add("mermaid-rendered");
  }
}

async function highlightCode(root: HTMLElement): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>("pre code")];
  if (nodes.length === 0) return;
  const { default: hljs } = await import("highlight.js/lib/common");
  for (const node of nodes) {
    const language = [...node.classList].find((c) => c.startsWith("language-"))?.slice("language-".length);
    if (language !== undefined && hljs.getLanguage(language) === undefined) continue;
    hljs.highlightElement(node);
  }
}

export async function enhance(root: HTMLElement): Promise<void> {
  await Promise.all([renderMath(root), renderDiagrams(root), highlightCode(root)]);
}
