import { Hono } from "hono";

import type { AppEnv } from "./common/types/context.ts";
import { blobController, deviceController, vaultController } from "./controllers/index.ts";

export const router = new Hono<AppEnv>()
  .route("/v1/devices", deviceController)
  .route("/v1/vaults", vaultController)
  .route("/v1/blobs", blobController);
