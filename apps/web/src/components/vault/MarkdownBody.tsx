import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";

import { useVault } from "../../contexts/VaultContext.tsx";
import { vaultService } from "../../lib/client/services/vault.service.ts";
import { splitFrontmatter, withoutLeadingTitle } from "../../lib/markdown/links.ts";
import { isInternalHref, renderMarkdown } from "../../lib/markdown/render.ts";
import { noteHref } from "../../lib/routes.ts";
import { displayName } from "../../lib/tree.ts";

interface MarkdownBodyProps {
  readonly text: string;
  readonly path: string;
}

function Properties({ properties }: { readonly properties: ReadonlyArray<readonly [string, string]> }) {
  if (properties.length === 0) return null;
  return (
    <dl className="mb-8 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-1.5 border-b app-line pb-6 text-sm">
      {properties.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="app-soft truncate">{key}</dt>
          <dd className="min-w-0 break-words">{value === "" ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MarkdownBody({ text, path }: MarkdownBodyProps) {
  const { index } = useVault();
  const navigate = useNavigate();
  const { properties, html } = useMemo(() => {
    const parts = splitFrontmatter(text);
    const rendered = renderMarkdown(withoutLeadingTitle(parts.body, displayName(path)), {
      index,
      from: path,
      noteHref,
      fileUrl: vaultService.currentUrl,
    });
    return { properties: parts.properties, html: rendered };
  }, [text, path, index]);

  const body = useCallback(
    (element: HTMLDivElement) => {
      const onClick = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || event.metaKey || event.ctrlKey || event.button !== 0) return;
        const href = event.target.closest("a[href]")?.getAttribute("href");
        if (href == null || !href.startsWith("/f/") || !isInternalHref(href)) return;
        event.preventDefault();
        void navigate(href);
      };
      element.addEventListener("click", onClick);
      return () => {
        element.removeEventListener("click", onClick);
      };
    },
    [navigate],
  );

  return (
    <>
      <Properties properties={properties} />
      <div ref={body} className="prose-note" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
