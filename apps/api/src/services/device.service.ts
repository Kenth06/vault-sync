import type { EnrollRequest, EnrollResponse } from "@vault-sync/protocol";

import { BaseService } from "./base.service.ts";

export class DeviceService extends BaseService {
  enroll(input: EnrollRequest): Promise<EnrollResponse> {
    return this.vault(input.vaultId).enroll(input.vaultId, input.name);
  }
}
