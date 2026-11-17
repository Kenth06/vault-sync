import { VaultPath } from "@vault-sync/protocol";
import { z } from "zod";

const vaultParamSchema = z.object({ vaultId: z.string() });

export const rawFileParamSchema = vaultParamSchema.extend({ path: VaultPath });
