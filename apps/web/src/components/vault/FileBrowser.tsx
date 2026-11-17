import { Input } from "@cloudflare/kumo";
import { useState } from "react";
import { Link } from "react-router";

import { useVault } from "../../contexts/VaultContext.tsx";
import { noteHref } from "../../lib/routes.ts";
import { displayName, filterFiles } from "../../lib/tree.ts";
import { FileTree } from "./FileTree.tsx";

const MAX_RESULTS = 200;

function Results({ query }: { readonly query: string }) {
  const { files } = useVault();
  const matches = filterFiles(files, query);
  if (matches.length === 0) return <p className="app-soft px-3 py-2 text-[13px]">No file matches “{query}”.</p>;
  return (
    <ul className="flex flex-col gap-px">
      {matches.slice(0, MAX_RESULTS).map((file) => (
        <li key={file.path}>
          <Link to={noteHref(file.path)} className="app-press flex flex-col rounded-md px-2 py-1.5 hover:app-hover">
            <span className="truncate text-[13px] font-medium">{displayName(file.path)}</span>
            <span className="app-soft truncate text-xs">{file.path}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FileBrowser({ active }: { readonly active: string | null }) {
  const { files, loading } = useVault();
  const [query, setQuery] = useState("");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Input
          size="sm"
          type="search"
          aria-label="Search files"
          placeholder="Search files"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="w-full min-w-0"
        />
      </div>
      <nav aria-label="Vault files" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <p className="app-soft px-3 py-2 text-[13px]">Loading files…</p>}
        {query.trim() === "" ? <FileTree files={files} active={active} /> : <Results query={query} />}
      </nav>
    </div>
  );
}
