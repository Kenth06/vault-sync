import type { VaultId } from "@vault-sync/protocol";
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

import { useAsync } from "../lib/client/hooks/useAsync.ts";
import { sessionService } from "../lib/client/services/vault.service.ts";

interface SessionValue {
  readonly vaultId: VaultId | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly signIn: (vaultId: string, adminSecret: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const session = useAsync((signal) => sessionService.current(signal), "session", revision);

  const signIn = useCallback(async (vaultId: string, adminSecret: string) => {
    await sessionService.signIn(vaultId, adminSecret);
    setRevision((n) => n + 1);
  }, []);

  const signOut = useCallback(async () => {
    await sessionService.signOut();
    setRevision((n) => n + 1);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      vaultId: session.data?.vaultId ?? null,
      loading: session.data === null && session.loading,
      error: session.error,
      signIn,
      signOut,
    }),
    [session.data, session.loading, session.error, signIn, signOut],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const value = use(SessionContext);
  if (value === null) throw new Error("useSession needs <SessionProvider>");
  return value;
}
