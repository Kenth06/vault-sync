import type { ServiceDependencies } from "./services/base.service.ts";
import { BlobService, DeviceService, VaultService } from "./services/index.ts";

export interface Container {
  readonly deviceService: DeviceService;
  readonly vaultService: VaultService;
  readonly blobService: BlobService;
}

export function createContainer(env: Env): Container {
  const deps: ServiceDependencies = { vaults: env.VAULT, bucket: env.BUCKET };
  return {
    deviceService: new DeviceService(deps),
    vaultService: new VaultService(deps),
    blobService: new BlobService(deps),
  };
}
