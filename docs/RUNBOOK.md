# Runbook

Connect to the database with the `DATABASE_URL` from your secret store. API logs are JSON, one object per line.

## 1. A pipeline looks stuck

Symptom: a run stays `running`, or "a run is already in progress" (HTTP 409).

1. Look at the run:
   ```sql
   SELECT id, source_id, kind, started_at, now() - started_at AS age FROM runs WHERE status = 'running';
   ```
2. Wait if the age is under 15 minutes. The run may be large.
3. After 15 minutes the next run attempt marks the old run `failed` ("abandoned") by itself, then starts.
4. To free it now:
   ```sql
   UPDATE runs SET status='failed', error='manual: stuck', finished_at=now() WHERE id = <id>;
   ```
5. Run the source again. The load is idempotent and the watermark did not move, so nothing is lost or doubled.
6. Check the API logs for the cause (REST source down, database slow).

Why it is safe: each run is one database transaction. A crash rolls back data and watermark together.

## 2. Schema drift

Symptom: scorecard shows `schema_drift` failed, with "missing" or "unexpected" columns.

1. Open the run: `GET /api/runs/<id>` shows the check detail.
2. **Unexpected column:** the customer added a field. Extra fields are ignored, nothing breaks. Ask whether they want it loaded, then add a migration and a column.
3. **Missing column:** the rows fail validation and land in dead letters. Ask the customer to fix the export. Do not guess values.
4. After the customer sends a fixed file, upload it. Rows with the same `external_id` update in place.

## 3. Replay dead letters

1. Open **Dead letters**. Read the reason on each card.
2. Fix the value in the JSON box and select **Replay**. The row goes through the same validation and SQL load.
3. If the reason is wrong data in the customer system, **Discard** it and tell the customer.
4. Many rows with the same reason: fix the cause first, then re-run the source or re-upload the file. A re-run is safe.
5. A replay that is still invalid returns an error and keeps the dead letter.

## 4. Failed runs

1. `SELECT id, source_id, error FROM runs WHERE status='failed' ORDER BY id DESC LIMIT 10;`
2. `source returned HTTP 401`: API key changed. Recreate the source with the new key.
3. `source returned HTTP 429` after retries: lower the schedule or ask for a higher limit.
4. Database errors: check Postgres health and disk. Nothing was loaded for that run.

## 5. Sign-in problems

- "login failed": check the IdP issuer URL and client secret. See the `auth.login` rows with outcome `error` in the audit log.
- "no role for this console": the IdP user has no `roles` claim with admin, engineer or viewer.

## 6. Alerts to set (suggested, not shipped)

- `increase(pipeline_runs_total{status="failed"}[1h]) > 0`
- `dead_letters_pending > 100`
- `histogram_quantile(0.95, sum by (le) (rate(pipeline_run_duration_seconds_bucket[5m]))) > 30`

## 7. Rotate the source credential key

Source credentials are encrypted with a key encryption key (KEK). The key id names the KEK. The secret provider holds each KEK under the name `source-kek-<kid>`.

1. Create the new KEK in the secret provider under `source-kek-<new-kid>`. Use 32 random bytes in base64.
2. Set `SOURCE_KEK_ACTIVE=<new-kid>` on the API.
3. Set `SOURCE_KEK_PREVIOUS` to the old key ids, comma separated. Example: `SOURCE_KEK_PREVIOUS=dev1`.
4. Set `SOURCE_KEK_GRACE_UNTIL` to an ISO date. Old key ids decrypt rows until this date. After the date the API refuses them with "the grace window ended".
5. Restart the API. New writes use the new key id. Old rows still decrypt during the grace window.
6. Run the rotation command:
   ```
   npm run rotate --workspace api -- --to <new-kid>
   ```
   The command decrypts each source row with the keyring and re-encrypts it with the new key id. It uses one transaction per row. It writes one audit row with action `secrets.rotated` and counts only.
7. Run the command again. Rows that already use the new key id are skipped. The second run is safe.
8. Check the audit log:
   ```sql
   SELECT actor, action, target, detail, at FROM audit_log WHERE action='secrets.rotated' ORDER BY id DESC LIMIT 5;
   ```
9. After the grace date, remove the old key ids from `SOURCE_KEK_PREVIOUS` and clear `SOURCE_KEK_GRACE_UNTIL`. Delete the old KEK in the secret provider.
