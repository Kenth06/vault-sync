import type { VaultId } from "@vault-sync/protocol";

import type { Container } from "../../di.ts";

export interface DeviceAuth {
  readonly token: string;
  readonly vaultId: VaultId;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { container: Container };
}

export interface DeviceEnv {
  Bindings: Env;
  Variables: { container: Container; auth: DeviceAuth };
}
