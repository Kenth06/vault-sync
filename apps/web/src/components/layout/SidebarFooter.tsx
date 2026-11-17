import { Button, DropdownMenu } from "@cloudflare/kumo";
import { ClockCounterClockwiseIcon, ArchiveIcon, DotsThreeIcon } from "@phosphor-icons/react";
import { NavLink } from "react-router";

import { useSession } from "../../contexts/SessionContext.tsx";
import { useTheme, type ThemePreference } from "../../hooks/useTheme.ts";

const LINK = "app-press flex h-8 items-center gap-2 rounded-md px-2 text-[13px]";
const THEMES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return `${LINK} ${isActive ? "app-selected font-medium" : "hover:app-hover"}`;
}

function SettingsMenu() {
  const { signOut } = useSession();
  const { preference, setPreference } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={<Button variant="ghost" size="sm" shape="square" icon={DotsThreeIcon} aria-label="Settings" />}
      />
      <DropdownMenu.Content>
        <DropdownMenu.Group>
          <DropdownMenu.Label>Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={preference}
            onValueChange={(value: string) => {
              setPreference(THEMES.find((t) => t.value === value)?.value ?? "system");
            }}
          >
            {THEMES.map((theme) => (
              <DropdownMenu.RadioItem key={theme.value} value={theme.value}>
                {theme.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          onClick={() => {
            void signOut();
          }}
        >
          Sign out of this browser
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

export function SidebarFooter() {
  return (
    <div className="flex items-end justify-between gap-2 border-t app-line px-2 py-2">
      <nav aria-label="Vault" className="flex flex-col gap-px">
        <NavLink to="/" end className={navClass}>
          <ClockCounterClockwiseIcon size={16} aria-hidden className="app-soft" />
          Recent changes
        </NavLink>
        <NavLink to="/snapshots" className={navClass}>
          <ArchiveIcon size={16} aria-hidden className="app-soft" />
          Snapshots
        </NavLink>
      </nav>
      <SettingsMenu />
    </div>
  );
}
