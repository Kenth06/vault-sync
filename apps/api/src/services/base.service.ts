import type { VaultId } from "@vault-sync/protocol";

import { AppError } from "../common/errors.ts";
import type { VaultDO } from "../durable-objects/vault.durable-object.ts";
import type { RpcResult } from "../utils/rpc-result.ts";

export interface ServiceDependencies {
  readonly vaults: DurableObjectNamespace<VaultDO>;
  readonly bucket: R2Bucket;
}

export abstract class BaseService {
  protected readonly vaults: DurableObjectNamespace<VaultDO>;
  protected readonly bucket: R2Bucket;

  constructor(deps: ServiceDependencies) {
    this.vaults = deps.vaults;
    this.bucket = deps.bucket;
  }

  protected vault(vaultId: VaultId): DurableObjectStub<VaultDO> {
    return this.vaults.getByName(vaultId);
  }

  protected unwrap<T>(result: RpcResult<T>): T {
    if (result.ok) return result.value;
    throw new AppError(result.code, result.message, result.details);
  }
}
