import { Banner, Button } from "@cloudflare/kumo";
import { Outlet, useParams } from "react-router";

import { useSession } from "../../contexts/SessionContext.tsx";
import { useVault } from "../../contexts/VaultContext.tsx";
import { ApiError } from "../../lib/client/http/api.ts";
import { FileBrowser } from "../vault/FileBrowser.tsx";
import { SidebarFooter } from "./SidebarFooter.tsx";
import { VaultHeader } from "./VaultHeader.tsx";

export function Sidebar() {
  const active = useParams()["*"] ?? null;
  return (
    <>
      <VaultHeader />
      <FileBrowser active={active} />
      <SidebarFooter />
    </>
  );
}

function VaultError({ error }: { readonly error: Error }) {
  const { signOut } = useSession();
  const lostAccess = error instanceof ApiError && (error.code === "ERR_UNAUTHORIZED" || error.code === "ERR_FORBIDDEN");
  if (!lostAccess) {
    return (
      <Banner variant="error" title="Could not load the vault" description={error.message} className="rounded-none" />
    );
  }
  return (
    <Banner
      variant="alert"
      className="rounded-none"
      title="This browser lost access to the vault"
      description="Its device was revoked or its session expired. Sign in again with the admin secret."
      action={
        <Button size="sm" variant="secondary" onClick={() => void signOut()}>
          Sign in again
        </Button>
      }
    />
  );
}

export function AppShell() {
  const { error } = useVault();
  return (
    <div className="flex h-dvh">
      <aside className="app-sidebar hidden w-68 shrink-0 flex-col border-r app-line md:flex">
        <Sidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {error !== null && <VaultError error={error} />}
        <Outlet />
      </main>
    </div>
  );
}
