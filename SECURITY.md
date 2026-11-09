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
| Stolen or replayed login code | Authorization code flow with PKCE, `state`, `nonce`, one-use codes, signature, issuer, audience and expiry check on the ID token. RS256 only. Ten negative token tests. Rejected logins are audited | Done, tested against the mock provider. A Keycloak suite is written but not run |
| Script reads the session cookie | `HttpOnly` cookie. The CSRF token is returned by `/me`, not stored in a cookie | Done |
| Forged webhook | HMAC SHA-256 signature, constant-time compare, rejected calls are audited | Done, tested |
| Bad input | Zod on bodies, row validation before load, parameterised SQL only, 5 MB body limit | Done |
| Secrets in the repo | Env vars only. `.env` is ignored. K8s secret is a template. Terraform keeps the DB URL in Secret Manager | Done (state file would hold the generated DB password: see below) |
| Secrets in responses | API keys and webhook secrets are masked in source lists. The webhook secret is shown once | Done, tested |
| Source credentials in a database dump | AES-256-GCM envelope encryption with a data key per value and a key encryption key from a secret provider. Rotation with a grace window | Done, tested. The GCP adapter is tested with a fake HTTP client only |
| Machine clients | OAuth2 client credentials with scopes. Only routes that list scopes accept a machine token. Audited as `client:<id>` | Done, tested against the mock provider |
| Brute force on login | Token bucket per client address on login and callback, 429 with `Retry-After`, audited | Done, tested. Behind a proxy the address can be shared (see below) |
| Browser hardening | Security headers on the API and the web app. A static CSP with `unsafe-inline` (see ADR 0001) | Done, tested |
| Tampering with the audit trail | Database trigger blocks UPDATE and DELETE. Each row holds a hash of the previous row. Export and verify commands find a changed or deleted row | Done, tested. A DB superuser who rewrites the whole chain is not detected without an outside copy of the last hash |
| Vulnerable dependencies | `npm audit`, Trivy image scans, gitleaks and a CycloneDX SBOM in the security workflow, with an exceptions file that expires | Local runs clean (see docs/engagement/SECURITY-GATE.md). The workflow has not run on GitHub |
| Container hardening | Multi-stage builds, non-root user, K8s `runAsNonRoot`, read-only root filesystem, dropped capabilities | Done in manifests, not run on a cluster |

## Not done (be honest)

- **The identity provider is a mock.** It has no passwords and keeps keys in memory. The API reads OIDC discovery and the held-out Keycloak suite is written, but it did not run. No commercial provider was tested.
- **Login rate limit only.** Other API routes have no limit. The limiter uses the address that the API sees. Behind the web proxy many users can share one address. `trustProxy` is not set.
- **`/metrics` and `/openapi.json` are public** on the API. The Kubernetes ingress only exposes the web service, but the Cloud Run Terraform makes the API public too (see the risk decision record).
- **Sessions are server-side rows with no rotation** on privilege change and no idle timeout. A session keeps its role until it expires or the user signs out.
- **Roles come from the IdP `roles` claim only.** There is no user management screen.
- **Only source credentials are encrypted by the application.** Other data relies on disk encryption of the platform.
- **The web CSP allows inline scripts.** See ADR 0001.
- **No private-address check on REST source URLs.** Accepted in the risk decision record.
- **No tenant isolation.** One database, one customer.
- **Terraform state** holds the generated database password. Use an encrypted remote backend.
- **No penetration test, no formal review, no compliance claim.** See `docs/engagement/governance/CORRECTION.md`.

## Reporting

This is a personal project. Open an issue on the repository.
