# Security

This is a portfolio project. It shows security habits. It is not a hardened product. This file says what is done and what is not.

## What we protect

Customer order data (emails, amounts), sessions, webhook secrets, API keys for customer sources, and the audit trail.

## Threat model (short)

| Threat | Control | Status |
|---|---|---|
| Anonymous access to data | Every route except health, metrics, OpenAPI, login, callback and webhooks needs a session | Done, tested |
| User does more than their role allows | RBAC table on every route (viewer, engineer, admin), checked on the server | Done, tested (403 and audit entry) |
| Cross-site request forgery | `SameSite=Lax` session cookie plus a per-session CSRF token in the `x-csrf-token` header on every write | Done, tested |
| Stolen or replayed login code | Authorization code flow with PKCE, `state`, `nonce`, one-use codes, signature, issuer, audience and expiry check on the ID token | Done, tested against the mock provider only |
| Script reads the session cookie | `HttpOnly` cookie. The CSRF token is returned by `/me`, not stored in a cookie | Done |
| Forged webhook | HMAC SHA-256 signature, constant-time compare, rejected calls are audited | Done, tested |
| Bad input | Zod on bodies, row validation before load, parameterised SQL only, 5 MB body limit | Done |
| Secrets in the repo | Env vars only. `.env` is ignored. K8s secret is a template. Terraform keeps the DB URL in Secret Manager | Done (state file would hold the generated DB password: see below) |
| Secrets in responses | API keys and webhook secrets are masked in source lists. The webhook secret is shown once | Done, tested |
| Tampering with the audit trail | Database trigger blocks UPDATE and DELETE on `audit_log` | Done, tested. A DB superuser can still drop the trigger |
| Vulnerable dependencies | `npm audit` in CI. Last local run: no high or critical findings | Partly: 7 moderate findings in a dev-only tool |
| Container hardening | Multi-stage builds, non-root user, K8s `runAsNonRoot`, read-only root filesystem, dropped capabilities | Done in manifests, not run on a cluster |

## Not done (be honest)

- **The identity provider is a mock.** It has no passwords and keeps keys in memory. Use a real provider (Okta, Entra ID, Google) in any real setting. The API does not use OIDC discovery. It uses fixed paths.
- **No rate limiting or lockout** on the API itself. Put it at the ingress or gateway.
- **`/metrics` and `/openapi.json` are public** on the API. The Kubernetes ingress only exposes the web service, but the Cloud Run Terraform makes the API public too (see DECISIONS).
- **Sessions are server-side rows with no rotation** on privilege change and no idle timeout. Logout deletes the row.
- **Roles come from the IdP `roles` claim only.** There is no user management screen.
- **No encryption of source credentials at rest** in the `sources.config` column (API keys are plain JSON in Postgres). Use a KMS or secret manager in production.
- **No tenant isolation.** One database, one customer.
- **No security headers or CSP** are set by the web app.
- **Terraform state** holds the generated database password. Use an encrypted remote backend.
- **No penetration test, no formal review.**

## Reporting

This is a personal project. Open an issue on the repository.
