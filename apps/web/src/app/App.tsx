import { Loader } from "@cloudflare/kumo";
import type { VaultId } from "@vault-sync/protocol";
import { createBrowserRouter, RouterProvider } from "react-router";

import { AppShell } from "../components/layout/AppShell.tsx";
import { useSession } from "../contexts/SessionContext.tsx";
import { VaultProvider } from "../contexts/VaultContext.tsx";
import { FilePage } from "./routes/FilePage.tsx";
import { HomePage } from "./routes/HomePage.tsx";
import { SignInPage } from "./routes/SignInPage.tsx";
import { SnapshotFilePage, SnapshotPage } from "./routes/SnapshotPage.tsx";
import { SnapshotsPage } from "./routes/SnapshotsPage.tsx";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "f/*", element: <FilePage /> },
      { path: "snapshots", element: <SnapshotsPage /> },
      { path: "snapshots/:seq", element: <SnapshotPage /> },
      { path: "snapshots/:seq/f/*", element: <SnapshotFilePage /> },
      { path: "*", element: <HomePage /> },
    ],
  },
]);

function Vault({ vaultId }: { readonly vaultId: VaultId }) {
  return (
    <VaultProvider key={vaultId} vaultId={vaultId}>
      <RouterProvider router={router} />
    </VaultProvider>
  );
}

export function App() {
  const { vaultId, loading } = useSession();
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader />
      </div>
    );
  }
  return vaultId === null ? <SignInPage /> : <Vault vaultId={vaultId} />;
}
