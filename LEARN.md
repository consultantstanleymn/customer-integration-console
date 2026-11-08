# LEARN: the concepts in this project

Each section: what it is, where it is in the code, and what to say in an interview. Read the code next to it. Every file is short.

## OIDC and SSO

**Plain words.** Single sign-on means the company's identity provider (IdP) checks who you are. Our app trusts the IdP's answer. OIDC is the standard way to ask. We use the "authorization code" flow:

1. Browser asks our API to log in. The API redirects the browser to the IdP with `state`, `nonce` and a PKCE challenge.
2. User signs in at the IdP. The IdP redirects back with a one-time `code`.
3. Our API sends the `code` plus the PKCE verifier to the IdP's token endpoint. It gets an ID token (a signed JWT).
4. The API checks the signature (IdP public keys), issuer, audience, expiry and nonce. Then it makes a session.

**Why each piece.** `state` stops login CSRF. `nonce` ties the token to this login. PKCE stops a stolen code from being used. The code is one-use.

**Where.** `api/src/auth.ts`, `api/src/auth-routes.ts`, `mocks/src/oidc.ts`.

**Say in an interview.** "I implemented the code flow with PKCE against a mock IdP I wrote, and I verified the ID token with `jose`. With a real IdP I would use discovery and a maintained library, and the main work is mapping the customer's groups to our roles."

## RBAC

**Plain words.** Role-based access control: users get a role, routes need a minimum role. Ours: viewer < engineer < admin.

**Where.** The `auth` field on each route in `api/src/routes.ts`, checked in `api/src/app.ts`. Denied calls are written to the audit log. Tests: `api/test/api.test.ts`.

**Say.** "The check is on the server, on every route, from one table. The UI hides buttons, but that is only for comfort. I test the 403 and the audit entry."

## CSRF and sessions

A browser sends cookies automatically, so another site could trigger a write. Defence: `SameSite=Lax` cookie and a secret token per session that must be in a header. Only our own page can read the token (via `/me`). The session id is in an `HttpOnly` cookie, so scripts cannot read it.

## ETL and ELT

**Plain words.** Extract (get data), Transform (clean and reshape), Load (store). We do E, then validate, then L into a staging table, then T in SQL. That order is often called ELT.

**Where.** `api/src/pipeline/extract.ts`, `api/src/pipeline/run.ts`, `api/sql/transforms/*.sql`.

**Say.** "Connectors only fetch. Validation uses Zod. The transform is plain SQL in numbered files, so a customer's analyst can review it. I test the SQL outputs with a real Postgres."

## Watermarks and idempotent loads

**Watermark.** A bookmark: "I have everything up to this `updated_at`." The next run asks only for newer rows. It moves only after the data is committed, in the same transaction.

**Idempotent.** Running the same load twice gives the same result. We use `INSERT ... ON CONFLICT DO UPDATE ... WHERE excluded.updated_at > orders.updated_at`. Repeats do nothing. Older versions never overwrite newer ones.

**Say.** "Failures happen, so I made re-runs safe instead of trying to prevent failures. Atomic commit of data and watermark means no gaps and no doubles. Weak point: if the source has bad `updated_at` values, the watermark can skip rows."

## Dead-letter queue

Bad rows go to a table with the reason instead of failing the run or being dropped. A human fixes and replays them. Replay uses the same validation and SQL path. Tests: `api/test/pipeline.test.ts`, `api/test/api.test.ts`. UI: `web/app/dead-letters/page.tsx`.

**Say.** "One bad row should not block the other thousands, and it must never disappear silently. The replay path is the normal path, so there is no special code to get wrong."

## Data quality checks

Four checks per run, stored in `quality_results`: schema drift (missing or unexpected columns), nulls in required fields, duplicate keys in the batch, validation rate (at least 90 percent valid). The checks are a pure function (`api/src/quality.ts`) so they are easy to test.

**Say.** "Drift is the most common real problem when you integrate a customer. I surface it on the scorecard instead of failing silently. The thresholds are simple and should be tuned per customer."

## Rate limits and pagination

The REST client follows `next_cursor` and, on HTTP 429, waits for `Retry-After` (capped) and retries up to five times. Code: `extractRest`. The mock source can be set to a low limit to show it.

## Prometheus metrics

**Plain words.** The service exposes numbers at `/metrics`. Prometheus scrapes them every 15 seconds. Types: **counter** (only goes up: runs, rows), **gauge** (up and down: dead letters waiting), **histogram** (buckets for durations, so you can compute p95).

**Where.** `api/src/metrics.ts`, `observability/`. Grafana dashboard JSON is provisioned from files.

**Say.** "I measure what an on-call person asks: are runs failing, how many rows, how long, how many dead letters. I avoid high-cardinality labels: route patterns, not full URLs, and no user ids."

## Structured logs

Pino writes one JSON object per line. Cookies and auth headers are redacted. Log shippers parse this without regex.

## Kubernetes objects

- **Deployment:** runs N copies of a pod and replaces them in a rolling way. Has probes, resource limits, non-root user.
- **Pod:** one or more containers that run together.
- **Service:** a stable name and IP in front of changing pods (`api`, `web`).
- **Ingress:** the public HTTP entry. It sends the host to the `web` service. The API is not exposed.
- **ConfigMap:** non-secret settings as env vars.
- **Secret:** secret settings. We ship a template only. Real values come from a secret manager.
- **HPA:** adds or removes replicas by CPU use (2 to 6).
- **Probes:** readiness decides if a pod gets traffic. Liveness decides if it is restarted.

**Say.** "I wrote the manifests and tested the rules we care about (probes, limits, selectors, HPA target). I did not run them on a cluster here, and I say so."

## Docker and Compose

Multi-stage builds keep build tools out of the final image. Containers run as a non-root user. Compose wires web, api, postgres and the two mocks. A profile adds Prometheus and Grafana.

## Terraform

Declares Cloud Run services, Cloud SQL Postgres, a bucket and secrets. It is written to be reviewed. I did not run `validate` or `apply` on this machine.

## OpenAPI

`docs/openapi.json` is generated from the route table with Zod's JSON Schema output. A test checks every route is documented.

## What is simplified (honest list)

- The IdP is a mock, no discovery, no refresh tokens, no logout at the IdP.
- One customer, one database, no tenant isolation.
- Only one entity (orders). Real customers have many tables and need a mapping step.
- No scheduler. Runs start from the UI or API.
- A run loads the whole batch in memory. Fine for thousands of rows, not millions.
- Marts are rebuilt in full every run.
- Source credentials are stored unencrypted in Postgres.
- No pagination in the UI lists (limits of 25 to 200 rows).
- No alert rules shipped, only suggested in the runbook.
- Webhook events queue in Postgres, with no retry or ordering guarantee beyond insert order.
- The REST client trusts the source's cursor semantics. Offset-style cursors can skip rows if the source changes during a run.
- Kubernetes, Terraform, Compose and CI were not run end to end (see README).
- No Spark, Airflow or dbt. The aggregation is SQL. This was a choice, see DECISIONS.
