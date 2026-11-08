# Onboarding: connect your first source in 30 minutes

Audience: a customer engineer. You need an account with the **engineer** role.

## Before you start (5 min)

1. Pick the source type.
   - Files you export by hand: **CSV**.
   - A system with a REST API: **REST**.
   - A system that can send events: **Webhook**.
2. Check your data has these six columns. Names must match.

| Column | Rule |
|---|---|
| `external_id` | text, not empty, unique per order |
| `customer_email` | valid email |
| `amount` | number, 0 or more |
| `currency` | 3 letters, for example `USD` |
| `status` | text, for example `paid` |
| `updated_at` | date and time, ISO 8601 |

Extra columns are not loaded. They show up as **schema drift** in the quality scorecard.

## Option A: CSV (10 min)

1. Open **Sources**. Enter a name, choose **CSV upload**, select **Create source**.
2. Select **Upload CSV** on the new row and choose your file. See `sample-data/orders_good.csv`.
3. Read the green message: rows in, loaded, failed.
4. Open **Dashboard**. Check the run and the quality card.

## Option B: REST API (15 min)

Your API must return `{ "data": [ ...rows ], "next_cursor": "..." | null }` for `GET /orders?limit=&cursor=&updated_since=`. It must accept an `x-api-key` header. Answer HTTP 429 with `Retry-After` when you rate limit. The mock in `mocks/src/source.ts` is the reference.

1. **Sources**, type **REST API**, enter the base URL and the API key.
2. Select **Run now**. The first run loads everything. The next run asks only for rows newer than the watermark.

## Option C: Webhook (15 min)

1. **Sources**, type **Webhook**, create. Copy the secret from the green message. It is shown once.
2. Your system sends `POST /api/webhooks/<id>` with a JSON body (one row, or an array of rows) and the header `x-signature: sha256=<hex>`. The signature is HMAC SHA-256 of the raw body with the secret.
3. Events wait in a queue. Select **Run now** to load them.

```bash
BODY='{"external_id":"H-1","customer_email":"a@b.co","amount":9,"currency":"USD","status":"paid","updated_at":"2026-03-01T10:00:00Z"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -X POST "$WEB/api/webhooks/3" -H "content-type: application/json" -H "x-signature: $SIG" -d "$BODY"
```

## Check the result (5 min)

- **Dashboard:** run status, throughput, quality scorecard, connector health.
- **Dead letters:** each bad row with its reason. Fix the JSON and select **Replay**, or **Discard**.
- A source is **healthy** when the last run succeeded and no dead letters wait.

## If something looks wrong

See [RUNBOOK.md](RUNBOOK.md).
