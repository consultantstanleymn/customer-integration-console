# Decisions

Short records. Each has the reason and the cost.

1. **Fastify API plus Next.js web, two services.** The API is useful without the UI (webhooks, scripts). Cost: two deployables. The web app proxies `/api/*` so cookies are first-party and there is no CORS.
2. **Route table drives everything.** One array holds method, path, minimum role and Zod schema. Registration, RBAC and the OpenAPI file come from it, so docs cannot drift. Cost: a small custom layer instead of a plugin ecosystem.
3. **Hand-made mock OIDC provider.** It runs offline and teaches the flow (code, PKCE, nonce, RS256). Cost: it proves only that we follow the protocol, not that we work with a real provider.
4. **Server-side sessions in Postgres, not JWT cookies.** Logout and role changes take effect at once. Cost: one query per request.
5. **CSRF token per session in a header**, plus `SameSite=Lax`. Simple and easy to test.
6. **ELT style: load staged rows, transform in SQL files.** The customer's analysts can read and change the SQL. Transforms are numbered files run in order. Cost: no dbt features (lineage, docs, tests as a framework). The tests in `api/test/pipeline.test.ts` check outputs of the SQL.
7. **One transaction per run.** Data, dead letters, quality results and watermark commit together. Cost: long runs hold a transaction. Fine at this size. Large loads would need batching with a durable checkpoint.
8. **Watermark = highest `updated_at` loaded.** Plus an upsert that only accepts newer versions. So late or repeated data is harmless. Cost: a source that does not set `updated_at` correctly will be missed.
9. **Bad rows are dead letters, not run failures.** One bad row must not block the other 10,000. A quality check fails when under 90 percent of rows are valid.
10. **Replay goes through the normal pipeline.** No special code path. A replay run is excluded from the quality scorecard.
11. **Marts rebuilt in full** (`DROP` and `CREATE TABLE AS`) each run. Simple and correct. Does not scale to very large tables.
12. **Recharts** for charts. It is small to use, accessible with a text alternative on the wrapper. Cost: bundle size (about 120 kB on the dashboard page).
13. **GCP Terraform with Cloud Run and Cloud SQL.** Chosen because it has the least moving parts for two containers. The landing bucket is provisioned but the app does not read from it yet. The API is public on Cloud Run (the web app calls it through the browser proxy, which runs server side in Next.js). Locking the API to the web service only needs a service-to-service identity. That is not done.
14. **No Python or Spark job.** The aggregation lives in SQL marts. Pandas is not installed on the build machine, so a Python job could not be run and tested. We did not ship code we could not run.
15. **No scheduler.** Runs start from the UI or API. A real deployment would use a Kubernetes CronJob or Cloud Scheduler that calls the run endpoint. Not built.
