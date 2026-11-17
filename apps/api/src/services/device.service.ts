import type { DeviceId, DeviceInfo, EnrollRequest, EnrollResponse, VaultId } from "@vault-sync/protocol";

import { BaseService } from "./base.service.ts";

export class DeviceService extends BaseService {
  enroll(input: EnrollRequest): Promise<EnrollResponse> {
    return this.vault(input.vaultId).enroll(input.vaultId, input.name);
  }

  list(vaultId: VaultId): Promise<DeviceInfo[]> {
    return this.vault(vaultId).listDevices();
  }

  async revoke(vaultId: VaultId, deviceId: DeviceId): Promise<void> {
    this.unwrap(await this.vault(vaultId).revokeDevice(deviceId));
  }
}
