import { Button, Input } from "@cloudflare/kumo";
import { useState } from "react";

import { useSession } from "../../contexts/SessionContext.tsx";
import { ApiError } from "../../lib/client/http/api.ts";

function signInError(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === "ERR_UNAUTHORIZED") return "That admin secret is not right.";
  if (failure instanceof ApiError && failure.code === "ERR_BAD_REQUEST") {
    return "Vault ids use 2 to 63 lowercase letters, digits and dashes.";
  }
  return failure instanceof Error ? failure.message : "Could not open the vault. Try again.";
}

function Intro() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">Open your vault</h1>
      <p className="app-soft text-sm">
        Read your notes, their history and snapshots from any browser. The admin secret is used once to create a
        read-only session for this browser and is never stored.
      </p>
    </div>
  );
}

function SubmitRow({ busy, disabled, error }: { busy: boolean; disabled: boolean; error: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <Button type="submit" variant="primary" loading={busy} disabled={disabled}>
        Open vault
      </Button>
      {error !== null && (
        <p role="alert" className="text-sm text-kumo-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function SignInPage() {
  const { signIn } = useSession();
  const [vaultId, setVaultId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(vaultId.trim(), secret);
    } catch (failure) {
      setError(signInError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex w-full max-w-sm flex-col gap-5"
      >
        <Intro />
        <Input
          label="Vault id"
          placeholder="notas"
          autoComplete="username"
          value={vaultId}
          onChange={(event) => {
            setVaultId(event.target.value);
          }}
          className="w-full min-w-0"
        />
        <Input
          label="Admin secret"
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value);
          }}
          className="w-full min-w-0"
        />
        <SubmitRow busy={busy} disabled={vaultId.trim() === "" || secret === ""} error={error} />
      </form>
    </main>
  );
}
