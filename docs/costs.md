# Costs, spend limits and alerts

Target plan: Workers Paid (USD 5/month base). Free-plan limits (10 ms CPU, 50 subrequests, 1 GB per DO) are too small for a real vault.

## What drives the bill

| Driver                      | Where it comes from                                         | How the code keeps it down                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DO requests                 | Every API call reaches `VaultDO`                            | Auth runs inside the operation's RPC: one DO request per API call. Blob upload is the only path with two (`authorize`, then `registerBlob`).                                                                     |
| DO duration (GB-s)          | Time a DO is active, including time awaiting I/O            | No `fetch` from the DO; R2 lookups in `commit` are batched with `Promise.all` and capped at 50. The maintenance alarm runs at most once a day per vault, and only while there is work (see `docs/decisions.md`). |
| DO storage                  | SQLite rows (`files`, `changes`, `blobs`, `snapshots`)      | ~200 B/row: 100k files + 1M changes ≈ 250 MB. Log compaction is still open; the 10 GB per-DO limit leaves ample room.                                                                                            |
| Worker requests / CPU       | Each HTTP call                                              | Hashing happens on the client; R2 verifies SHA-256 server side; bodies stream without buffering.                                                                                                                 |
| R2 Class A / B ops, storage | PUT/HEAD/GET of blobs, one snapshot PUT per day, GC deletes | Content-addressed dedupe within the vault. Snapshots are gzip JSON (a few MB for 100k files); retention keeps at most 42. GC deletes orphans after 7 days in batches of 1000 keys per call.                      |

The biggest lever is the client: the daemon debounces (~2 s), batches up to 500 changes / 50 MB and backs off on errors. A regression there multiplies every line above.

Live updates use hibernatable WebSockets: an idle connection costs no DO duration, the 30 s `ping` is answered by the runtime without waking the object, and the broadcast runs inside the commit that already woke it.

Every sync starts with one `/changes` request (one DO request), even when nothing changed, and files written by a pull trigger the local watcher once more. Both stay far below the rate limit.

`GET /tree?at=<seq>` scans the change log up to `seq`, so its cost grows with the log until compaction exists; the live tree (`/tree` without `at`) reads only the `files` table.

A per-device rate limit (600 requests/minute, `RATE_LIMIT_PER_MINUTE` in `apps/api/src/common/constants.ts`) cuts off a runaway client before it costs real money.

## Spend policies (configure once per account)

Cloudflare supports per-product spending limits and email alerts for Workers and Durable Objects (Billing → Spend limits, or the `cf` CLI). They apply account-wide for the billing period. Blocking is not instantaneous, so recorded spend can exceed the limit.

Recommended starting point for a personal vault (amounts in US cents):

```sh
# Email alert at $5 of Durable Objects spend: usage keeps running
cf billing spend-policies create \
  --name 'DO alert $5' \
  --product-id durable_objects \
  --enabled true \
  --threshold-cents 500 \
  --action notification \
  --notification-email <you@example.com>

# Hard stop at $20 of Durable Objects spend: sync stops until raised or next period
cf billing spend-policies create \
  --name 'DO limit $20' \
  --product-id durable_objects \
  --enabled true \
  --threshold-cents 2000 \
  --action usage_block \
  --notification-email <you@example.com>

# Hard stop at $20 of Workers spend
cf billing spend-policies create \
  --name 'Workers limit $20' \
  --product-id workers \
  --enabled true \
  --threshold-cents 2000 \
  --action usage_block \
  --notification-email <you@example.com>
```

Notes:

- One enabled limit per product per account. Alerts email at 80% and 100% of their threshold.
- Limits created in the dashboard have no email recipient until you add one.
- A blocked Worker stops sync; the local vault is unaffected and the daemon retries with backoff.
- Account-wide budget alerts (Billing → Billable Usage) still apply on top of these.

Docs: https://developers.cloudflare.com/billing/manage/spend-management/ and https://developers.cloudflare.com/billing/manage/spend-management/cli/

## Before each deploy

Run the `do-cost-review` skill on the diff.
