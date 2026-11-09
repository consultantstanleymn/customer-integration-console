# Customer Integration Console

A TypeScript full-stack app that a forward deployed engineer could build for a customer. Connect data sources, run pipelines, see health and data quality, and keep an audit trail of who did what.

![Dashboard](docs/img/dashboard.png)

## What it does

- **Sources:** CSV upload, a REST API (cursor paging, API key, rate limit with retry), and a signed webhook.
- **Pipeline:** extract, validate with Zod, stage, transform with plain SQL files, load into Postgres. Incremental loads with a watermark. Safe to re-run.
- **Dead letters:** bad rows are parked with the reason. You can edit the row and replay it from the UI.
- **Data quality:** null check, duplicate keys, schema drift and validation rate. Stored for every run and shown as a scorecard.
- **Access:** single sign-on through OpenID Connect (a small mock provider runs locally), session cookies, three roles (admin, engineer, viewer), CSRF protection, append-only audit log.
- **Operations:** structured JSON logs, a Prometheus `/metrics` endpoint, a Grafana dashboard, Dockerfiles, Compose, Kubernetes manifests, Terraform for GCP, GitHub Actions.

## Verified locally

Every claim below was run on one laptop (MacBook Pro mid 2015, measured on one laptop). Dates are 2026-11-09. The evidence files hold the raw output and the commit.

| Claim | Command | Evidence | Date |
|---|---|---|---|
| Unit and API tests pass: 256 tests, 9 held-out tests skipped | `npm test` | `docs/engagement/evidence/baseline-local.txt` (baseline), run again at the last commit | 2026-11-09 |
| Browser tests pass with the CSP on: 7 tests | `npm run e2e` | `docs/engagement/evidence/web-csp-e2e.txt` | 2026-11-09 |
| An authorization matrix checks every route as anonymous, viewer, engineer, admin and machine | `npx vitest run api/test/authz-matrix.test.ts` | `docs/engagement/evidence/authz-matrix-run.txt`, `docs/engagement/evidence/authz-matrix.md` | 2026-11-09 |
| Ten bad-token cases are rejected (expired, audience, issuer, key id, signature, alg none, HS256 key confusion, nonce, replay) | `npx vitest run api/test/token-negative.test.ts` | `api/test/token-negative.test.ts` | 2026-11-09 |
| OIDC discovery works against the mock IdP | `npx vitest run api/test/oidc-discovery.test.ts` | `api/test/oidc-discovery.test.ts` | 2026-11-09 |
| Machine clients get scoped tokens; a missing scope gives 403 | `npx vitest run api/test/machine-scopes.test.ts` | `api/test/machine-scopes.test.ts` | 2026-11-09 |
| Source credentials use envelope encryption; rotation has a grace window | `npx vitest run api/test/envelope.test.ts api/test/rotation.test.ts` | `api/test/envelope.test.ts`, `api/test/rotation.test.ts` | 2026-11-09 |
| The audit log is hash chained; a changed or deleted row is found | `npx vitest run api/test/audit-chain.test.ts` | `docs/engagement/evidence/audit-chain-tamper.txt` | 2026-11-09 |
| Security headers, CSP and a login rate limit | `npx vitest run api/test/security-headers.test.ts web/test/headers.test.ts` | `api/test/security-headers.test.ts` | 2026-11-09 |
| gitleaks, npm audit, Trivy image scans (three images) and a CycloneDX SBOM ran clean | see the file | `docs/engagement/evidence/security-gate-local.txt`, `docs/engagement/evidence/sbom-source.cdx.json` | 2026-11-09 |

## Authored, not run

| File | What it would do | Why it did not run |
|---|---|---|
| `deploy/keycloak/realm-cic.json`, `api/test/oidc-heldout.test.ts`, `scripts/keycloak-heldout.sh` | Run the login and role suite against Keycloak | Authored, not run: written and syntax-checked with json.tool, podman compose config and shellcheck. Not executed against a real Keycloak server. Reason: tool not installed (image not pulled by owner decision) |
| `api/src/secrets/provider.ts` (GCP adapter) | Read secrets from GCP Secret Manager | Authored, not run: tested with a fake HTTP client. Not executed against GCP. Reason: no cloud account by design |
| `infra/` (Terraform for Cloud Run) | Create the cloud setup | Authored, not run: no terraform binary and no cloud account |
| `k8s/` | Deploy to a cluster | Authored, not run: checked by tests only, no cluster run |
| `.github/workflows/security.yml`, the CodeQL job and the new `ci.yml` steps | Run the security gate in GitHub Actions | Authored, not run: checked with actionlint. Not run on GitHub. Reason: needs GitHub Actions |

The engagement documents are in `docs/engagement/`. Start with `REVIEW-GUIDE.md`.

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|/ and /api/*| W[Next.js web :3000]
  W -->|proxy /api/*| A[Fastify API :4000]
  B -->|sign in| O[Mock OIDC provider]
  A -->|verify ID token| O
  A --> P[(Postgres)]
  A -->|pull, paged, rate limited| S[Mock REST source]
  C[Customer system] -->|signed webhook| A
  U[CSV file] -->|upload| A
  PR[Prometheus] -->|scrape /metrics| A
  G[Grafana] --> PR
```

Pipeline inside one run (one database transaction):

```mermaid
flowchart LR
  X[Extract] --> V[Validate with Zod]
  V -->|good rows| T[Stage table]
  V -->|bad rows| D[(dead_letters)]
  T --> L[SQL transform and upsert]
  L --> M[SQL marts]
  L --> Q[Quality checks]
  Q --> WM[Move watermark]
```

More: [OpenAPI](docs/openapi.json), [ONBOARDING](docs/ONBOARDING.md), [RUNBOOK](docs/RUNBOOK.md), [DEMO](docs/DEMO.md), [DECISIONS](docs/DECISIONS.md), [SECURITY](SECURITY.md), [LEARN](LEARN.md).

## Screenshots

| Sources | Dead letters | Audit log |
|---|---|---|
| ![Sources](docs/img/sources.png) | ![Dead letters](docs/img/dead-letters.png) | ![Audit](docs/img/audit.png) |

## Run it

You need Node 22. The stack script also needs the PostgreSQL server binaries (`initdb`, `pg_ctl`) on your PATH. It starts a throw-away database, so no Docker is needed.

```bash
npm install
npm run stack        # prints the URLs, uses random free ports
```

Open the web URL, click "Sign in with SSO", pick a test user:

| User | Role |
|---|---|
| Alice Admin | admin: everything, audit log, delete sources |
| Bob Engineer | engineer: create sources, run, upload, replay |
| Carol Viewer | viewer: read only |

The mock REST source needs the API key `demo-key`. Sample files are in `sample-data/`.

### With Docker

```bash
cp .env.example .env
docker compose up --build                              # web :3000, mock IdP :4100, mock source :4200
docker compose --profile observability up --build      # adds Prometheus :9090 and Grafana :3001
```

## Test it

```bash
npm run lint
npm run typecheck
npm test            # vitest, starts its own throw-away Postgres (or set TEST_DATABASE_URL)
npm run e2e         # Playwright on the full local stack (needs: npx playwright install chromium)
npm run openapi     # regenerates docs/openapi.json from the route table
```

## What was verified (2026-11-07, on the build machine)

| Check | Result |
|---|---|
| `npm test` | 99 tests, 6 files, all pass (2026-11-07). See "Verified locally" for the current count |
| `npm run e2e` | 7 Playwright tests pass on the local stack |
| `npm run lint`, `npm run typecheck` | clean |
| `npm audit --audit-level=high` | no high or critical findings; 7 moderate remain in a dev-only lint dependency (minimatch) |
| `next build`, `tsc` build of the API | succeed; the built API starts and answers `/health` |
| `podman build` of the three Dockerfiles | succeed |
| `podman-compose config` on `docker-compose.yml` | valid |

## What was NOT verified

- `docker compose up` was not run end to end (Docker is not installed here). The images build, and the stack runs through `npm run stack`.
- Prometheus and Grafana were not started. A test checks that the dashboard only queries metrics the API exports.
- Kubernetes: `kubectl` and `kubeconform` are not installed. A vitest file checks the manifests (probes, limits, selectors, HPA targets, no secrets). CI runs kubeconform, but that has not run.
- Terraform: not installed, so `terraform validate` was not run. Nothing was applied.
- The GitHub Actions jobs added after 2026-11-08 have not been checked on GitHub.

See [LEARN.md](LEARN.md) for the list of simplifications.

## Layout

```
api/      Fastify API, pipeline, SQL migrations and transforms, tests
web/      Next.js (App Router), Tailwind, Recharts
mocks/    mock OIDC provider and mock REST source
e2e/      Playwright tests (they also take the README screenshots)
k8s/ infra/ observability/ docs/ scripts/ sample-data/
```

License: MIT, copyright Stanley Sujith Nelavala.
