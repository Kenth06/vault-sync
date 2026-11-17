import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

interface PageBarProps {
  readonly crumbs: readonly string[];
  readonly back?: { readonly to: string; readonly label: string };
  readonly actions?: ReactNode;
}

const HOME = { to: "/", label: "Files" } as const;

export function PageBar({ crumbs, back = HOME, actions }: PageBarProps) {
  const last = crumbs.length - 1;
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b app-line bg-[var(--app-bg)] px-3 md:px-6">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <Link
          to={back.to}
          aria-label={back.label}
          className="app-press -ml-1 flex size-9 shrink-0 items-center justify-center rounded-md hover:app-hover md:hidden"
        >
          <ArrowLeftIcon size={16} aria-hidden />
        </Link>
        <ol className="flex min-w-0 items-center gap-1.5">
          {crumbs.map((crumb, i) => (
            <li
              key={crumbs.slice(0, i + 1).join("/")}
              className={`flex min-w-0 items-center gap-1.5 ${i === last ? "" : "max-md:hidden"}`}
            >
              <span className={`truncate ${i === last ? "font-medium" : "app-soft"}`}>{crumb}</span>
              {i !== last && (
                <span aria-hidden className="app-soft opacity-60">
                  /
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
