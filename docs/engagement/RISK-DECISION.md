# Risk Decision Record

## Metadata
- Label: risk decision record
- Date: 2026-11-09
- Code commit: c0b0b77
- Machine: local workstation
- Command: none
- Notes: Accepted risks for FoodDistCo. Each entry has an owner, a review date and compensating controls.
---

## Decision summary

| Field | Value |
|---|---|
| Owner | Stanley Sujith Nelavala |
| Review date | 2027-02-07 |
| Status | Accepted |
| Scope | The FoodDistCo order ingestion console |

The owner reviews this record on or before the review date. The owner can extend, change or close each risk. A closed risk needs a control and a test.

## R-1 Public API URL

### Decision

Accept: the API is reachable on the public Cloud Run URL until a service identity and an internal load balancer exist.

### Context

The API runs on Cloud Run. Cloud Run gives each service a public HTTPS URL. The team has no service identity and no internal load balancer yet. A network-level block is not possible today.

### Options

1. Block all public traffic now. This stops the console for all users until the load balancer exists.
2. Put the API behind an internal load balancer now. This needs a service identity, a private network path and more setup time.
3. Accept the public URL and add application controls. This keeps the console usable.

### Decision

Option 3. Accept the public URL. Add compensating controls at the application layer.

### Compensating controls

- OIDC login with issuer, audience, nonce and algorithm checks (`api/src/auth.ts`).
- RBAC matrix test that calls every route as anonymous, viewer, engineer and admin (`api/test/authz-matrix.test.ts`).
- Login rate limit (`api/src/app.ts`).
- Audit hash chain with a verify command (`api/src/audit-chain.ts`).
- CI security gate: CodeQL, gitleaks, Trivy, `npm audit`, SBOM and an exceptions file.

### Review trigger

Review this decision when a service identity and an internal load balancer exist. Review it on the review date at the latest.

## R-2 T-14 No private-address check on REST source URL

### Decision

Accept. The API does not check a REST source URL against private address ranges.

### Context

An engineer or an admin can set a source URL. A URL can point to an internal host. This is a server-side request forgery (SSRF) path. See T-14 in `docs/engagement/THREAT-MODEL.md`.

### Compensating controls

- Only engineers and admins can set a source URL. The role rank check in `api/src/auth.ts` enforces this.
- The audit log records each source change with actor and action.
- The source list output masks the secret fields (`maskConfig`).

### Mitigation step

Add a private-address check and a host allow list to the source URL check. Add a test named `blocks an internal source url`.

## R-3 T-15 No CSV export

### Decision

Accept. The console does not export CSV files. The spreadsheet formula risk sits downstream.

### Context

A CSV cell can start with `=`, `+`, `-` or `@`. A spreadsheet program can run the cell as a formula. The console has no CSV export today. See T-15 in `docs/engagement/THREAT-MODEL.md`.

### Compensating controls

- The console has no CSV export path.
- The import path stores cell text as data.
- The audit log records each import.

### Mitigation step

If the console adds a CSV export, add a leading quote to formula cells. Add a test named `escapes csv formula cells`.

## R-4 T-18 JSON logs escape newlines

### Decision

Accept. The logger writes JSON lines. The encoder escapes a newline in a value.

### Context

A user can put a newline and a fake log entry in a field. A JSON encoder escapes the newline, so the value stays on one line. See T-18 in `docs/engagement/THREAT-MODEL.md`.

### Compensating controls

- The logger writes JSON lines (`api/src/logger.ts`).
- The log pipeline reads one JSON object per line.

### Mitigation step

Add a test named `escapes log fields` that sends a newline in a field and checks the log output.

## R-5 Login limiter shares one client address behind the web proxy

### Decision

Accept for now. The login limiter keys on the client address as the API sees it. Behind the web proxy all users can share one address, so the limit is shared. `trustProxy` is not set.

### Context

The web server forwards API calls. The API sees the address of the web server, not the address of the browser. The login limiter counts all users under one key. A busy office can hit the limit. A single attacker can also use up the shared limit.

### Compensating controls

- The login limiter still stops a flood from one address.
- OIDC login checks issuer, audience, nonce and algorithm.
- The audit log records each login attempt.

### Mitigation step

Set `trustProxy` to the proxy hop count when the API is deployed behind the web proxy. Then the limiter keys on the real client address. Add a test that checks the limiter key with a forwarded address.

## Review log

| Date | Owner | Action |
|---|---|---|
| 2026-11-09 | Stanley Sujith Nelavala | Record created. All risks accepted. |
