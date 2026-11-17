import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

interface LinkButtonProps {
  readonly href: string;
  readonly icon: Icon;
  readonly children: ReactNode;
  readonly variant?: "primary" | "ghost" | "pressed";
  readonly download?: boolean;
  readonly route?: boolean;
}

const VARIANTS = {
  primary: "h-9 bg-kumo-brand px-3 text-white hover:bg-kumo-brand-hover",
  ghost: "h-8 px-2.5 hover:app-hover",
  pressed: "h-8 px-2.5 app-raised",
} as const;

export function LinkButton(props: LinkButtonProps) {
  const { href, icon: IconComponent, children, variant = "ghost", download = false, route = false } = props;
  const className = `app-press inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium ${VARIANTS[variant]}`;
  const content = (
    <>
      <IconComponent size={16} aria-hidden />
      {children}
    </>
  );
  if (route) {
    return (
      <Link to={href} className={className} aria-pressed={variant === "pressed"}>
        {content}
      </Link>
    );
  }
  return (
    <a href={href} download={download ? "" : undefined} className={className}>
      {content}
    </a>
  );
}
