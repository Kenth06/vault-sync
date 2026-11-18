import api from "@vault-sync/api";

import { createApp } from "./app.ts";

const app = createApp((request, c) => api.fetch(request, c.env, c.executionCtx));

export { VaultDO } from "@vault-sync/api";

export default app satisfies ExportedHandler<Env>;
