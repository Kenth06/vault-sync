---
name: do-cost-review
description: Reviews a change for Durable Object and Workers billing impact (requests, duration, storage, R2 operations) against the vault-sync budget. Use when touching durable-objects/, services/, controllers/, alarms, the CLI sync loop, or before a deploy.
allowed-tools: Read Grep Glob Bash(git diff *)
---

Durable Objects bill per request, per GB-second of active duration and per stored GB. Read `docs/costs.md` for the budget and the spend policies, then check the diff against these rules:

1. **One DO request per API call.** Auth happens inside the operation's RPC (`authed`). Flag any route that calls the stub twice without a stated reason. The blob upload path is the known exception: `authorize` before writing to R2, then `registerBlob`.
2. **No idle wall-clock in the DO.** Awaiting R2 or `fetch` inside a DO method keeps it billed. Batch those awaits with `Promise.all` and cap them (`MAX_R2_LOOKUPS_PER_COMMIT`).
3. **No unbounded work per request.** Batches are capped at `MAX_BATCH_CHANGES`; queries chunk `IN (...)` lists; list endpoints take a `limit`.
4. **Alarms are scheduled only when work exists**, never as a heartbeat. `setAlarm` replaces the previous alarm.
5. **No WebSocket without hibernation** (F3). A non-hibernated socket keeps the DO billed for as long as it is open.
6. **The client is the biggest lever.** The daemon debounces (~2 s), batches up to 500 changes and backs off exponentially; a regression there multiplies every server-side cost.
7. **Rate limit stays on.** `RATE_LIMIT_PER_MINUTE` in `apps/api/src/common/constants.ts` cuts off runaway clients.

Report each finding with file:line, the cost driver it affects, and the fix.
