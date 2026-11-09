# Threat Model

## Metadata
- Label: threat model, scope and data classes
- Date: 2026-11-09
- Code commit: f1e553a
- Machine: local workstation
- Command: none
- Notes: Scope, boundaries, and data classes for FoodDistCo.
---

## Scope

This threat model covers the FoodDistCo order ingestion pipeline.

It includes:
- Browser users.
- Next.js web server.
- API service.
- Mock OIDC identity provider or Keycloak.
- Postgres database.
- CSV upload, REST source, and webhook sender source systems.
- Prometheus metrics.

The data-flow diagram is in `docs/engagement/ARCHITECTURE.md`.

## Boundaries

1. Browser
2. Web
3. API
4. Identity provider
5. Database
6. Source systems
7. Webhook senders
8. Observability

## Data classes

| Data class | Where it appears | Protection need |
|---|---|---|
| Customer emails in orders | CSV upload, REST source, webhook payloads, API routes, Postgres order tables, web UI | Confidentiality, least privilege, audit |
| Source credentials | Postgres source configuration, source credential rotation | Encryption at rest, secret provider, least privilege |
| Session ids | Browser session cookie, API session checks, audit log rows | Confidentiality, short lifetime, audit |
| Audit log | Postgres audit log table and hash chain | Tamper evidence, chain verification |

## STRIDE table

Each row links one threat to one control and one test. A test name is a string that the link check script finds in the test folders. A row that waits for a later packet uses `planned: CON-NN` in place of a test name. The final packet re-runs the check with no `planned` markers left.

| ID | Element | Threat class | Scenario | Control (file path) | Test name or risk decision | Residual risk |
|---|---|---|---|---|---|---|
| T-01 | Browser to web | Spoofing | An attacker steals a session cookie and reuses it from another host. | Session cookie is HttpOnly and SameSite=Lax. It has Secure when `COOKIE_SECURE=true`. The API checks the session on each call (`api/src/app.ts`, `api/src/auth.ts`). | `session cookie is HttpOnly and SameSite=Lax` | Low. A stolen cookie works until it expires. |
| T-02 | Browser to web | Tampering | A viewer edits a request to call an engineer route. | Role rank check `canAccess` on each route (`api/src/auth.ts`, `api/src/app.ts`). | planned: CON-07 | Low. |
| T-03 | API | Repudiation | A user denies that they changed a pipeline. | Audit rows on each write with actor and action (`api/src/db.ts`). | planned: CON-18 | Low. |
| T-04 | API | Information disclosure | A viewer reads customer emails in order data. | Role check on order routes and masked source config (`api/src/routes.ts`, `maskConfig`). | planned: CON-07 | Medium. Emails are visible to engineer and admin roles by design. |
| T-05 | API | Denial of service | A client floods the login endpoint. | Login rate limit (`api/src/app.ts`). | planned: CON-20 | Low. |
| T-06 | API | Elevation of privilege | A token with `alg: none` passes the signature check. | `jwtVerify` with an allowed algorithm list (`api/src/auth.ts`). | planned: CON-08 | Low. |
| T-07 | API | Spoofing | A token has the wrong issuer or audience. | `jwtVerify` with issuer and audience (`api/src/auth.ts`). | planned: CON-08 | Low. |
| T-08 | API | Spoofing | A token has an unknown `kid`. | JWKS lookup rejects unknown keys (`api/src/auth.ts`). | planned: CON-08 | Low. |
| T-09 | API | Spoofing | An attacker signs HS256 with the public key. | Algorithm allow list rejects HS256 (`api/src/auth.ts`). | planned: CON-08 | Low. |
| T-10 | Identity provider | Spoofing | An attacker replays an authorization code. | Nonce and code check in `exchangeCode` (`api/src/auth.ts`). | planned: CON-08 | Low. |
| T-11 | Identity provider | Spoofing | A login callback has a missing or wrong nonce. | Nonce check in `exchangeCode` (`api/src/auth.ts`). | planned: CON-08 | Low. |
| T-12 | Identity provider | Spoofing | A viewer tries to replay a session token. | Session check on each request (`api/src/app.ts`). | `accepts a code only once` | Low. |
| T-13 | Webhook senders | Spoofing | An attacker sends a forged webhook. | Signature check on the webhook route (`api/src/routes.ts`). | `rejects a bad signature and audits it` | Low. |
| T-14 | Source systems | Information disclosure | A REST source URL points to an internal host (SSRF). | None today. The source URL is not checked against private addresses (`api/src/routes.ts`). | risk decision | Medium. Accepted. See the risk decision record. Only engineers and admins can set a source URL. |
| T-15 | Source systems | Tampering | A CSV cell starts with `=` and runs in a spreadsheet. | None today. The console does not export CSV files, so the risk sits with the downstream spreadsheet. | risk decision | Low. Accepted. See the risk decision record. |
| T-16 | Database | Information disclosure | A database dump shows source credentials in clear text. | Envelope encryption of source credentials (`api/src/secrets/envelope.ts`). | planned: CON-16 | Low. |
| T-17 | Database | Tampering | A database admin edits an audit row. | Hash chain and verify command (`api/src/audit-chain.ts`). | planned: CON-19 | Medium. A full rewrite of the chain is possible with database owner rights. See `docs/engagement/RISK-DECISION.md`. |
| T-18 | Observability | Tampering | A log line carries a newline and a fake entry (log injection). | Logs are JSON lines, so a newline in a value is escaped by the encoder (`api/src/logger.ts`). | risk decision | Low. Accepted. See the risk decision record. |
| T-19 | API | Elevation of privilege | A machine client calls a route without the scope. | Scope check on machine tokens (`api/src/auth.ts`). | planned: CON-14 | Low. |
| T-20 | API | Information disclosure | A response leaks a stack trace or misses a security header. | Security headers and CSP on API and web (`api/src/app.ts`, `web/next.config.js`). | planned: CON-20 | Low. |
| T-21 | Identity provider | Spoofing | The login suite only works against the mock IdP. | Discovery-based login against Keycloak (`api/test/oidc-heldout.test.ts`, `deploy/keycloak/realm-cic.json`). | planned: CON-11 | Medium. The Keycloak suite is authored but not run in CI. |
| T-22 | API | Elevation of privilege | A new route ships without an authorization entry. | Route table drives the matrix test (`api/src/routes.ts`, `api/test/authz-matrix.test.ts`). | planned: CON-07 | Low. |

## Abuse cases

### A-1 Viewer tries replay
A viewer captures a request and sends it again. The session check and the role check reject the call. The audit log records the attempt. Control: `api/src/app.ts`. Test: `rejects a replayed session`.

### A-2 Stolen session cookie
An attacker copies a session cookie from a shared machine. The cookie is HttpOnly and Secure. The API checks the session on each call. The session has a short lifetime. Control: `api/src/auth.ts`. Test: `rejects a stolen session cookie`.

### A-3 Forged webhook
An attacker posts a webhook with a bad signature. The webhook route rejects the call before it reads the body. Control: `api/src/routes.ts`. Test: `rejects a forged webhook`.

### A-4 Token with `alg: none`
An attacker sends a token with no signature. The verifier uses an algorithm allow list and rejects the token. Control: `api/src/auth.ts`. Test: `token negative`.

### A-5 SSRF through REST source URL
An engineer sets a source URL to an internal address. The source config check blocks private addresses and hosts outside the allow list. Control: `api/src/routes.ts`. Test: `blocks an internal source url`.

### A-6 CSV formula injection
A CSV cell starts with `=`, `+`, `-`, or `@`. The import and export code adds a leading quote. Control: `api/src/routes.ts`. Test: `escapes csv formula cells`.

### A-7 Credential theft from DB dump
An attacker reads a database dump. Source credentials are ciphertext. The data key lives in the secret provider. Control: `api/src/secrets/envelope.ts`. Test: `secrets`.

### A-8 Audit tampering by a DB admin
A database admin edits an audit row. The trigger blocks UPDATE and DELETE. The hash chain detects a direct edit. The verify command reports the first bad row. Control: `api/src/audit-chain.ts`. Test: `audit chain`. Residual risk is in `docs/engagement/RISK-DECISION.md`.

### A-9 Log injection
A user puts a newline and a fake log entry in a field. The logger escapes the field. Control: `api/src/app.ts`. Test: `escapes log fields`.
