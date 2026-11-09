# Correction of the unreviewed governance draft

Source: `docs/engagement/governance/unreviewed-draft.md`.
This file corrects each claim line by line.
Verdict words: supported, partly supported, unsupported, false.
No compliance claim survives this review.

## Correction table

| # | Claim text | Verdict | Evidence | Corrected wording |
|---|---|---|---|---|
| 1 | SOC 2 ready. | unsupported | none | No SOC 2 audit was done. The repo has security controls and evidence files, but no SOC 2 report exists. |
| 2 | GDPR compliant. | unsupported | none | No GDPR assessment was done. The console processes customer emails, so a data protection review is needed before any compliance statement. |
| 3 | All data encrypted at rest. | false | `api/src/secrets/envelope.ts`, test `round trip` in `api/test/envelope.test.ts` | Only source credentials are encrypted by the application, with AES-256-GCM envelope encryption. Other tables rely on disk encryption of the platform, and this repo does not prove that. |
| 4 | MFA enforced. | false | none | MFA depends on the identity provider. The console does not enforce MFA. |
| 5 | Penetration tested. | unsupported | none | No penetration test was done. |
| 6 | Audit log is tamper-proof. | false | `api/src/audit-chain.ts`, tests `tampered row is detected` and `deleted row is detected` in `api/test/audit-chain.test.ts` | The audit log is tamper-evident by hash chain, not tamper-proof. A database admin who rewrites the full chain is not detected without an external anchor. |
| 7 | Secrets are never stored. | false | `api/src/secrets/envelope.ts`, test `created webhook source stores no plain secret` in `api/test/envelope.test.ts` | The webhook secret is shown once at creation and stored encrypted. No plain secret is stored in `sources` rows. |
| 8 | Role changes take effect at once. | false | none | A session keeps its role until it expires (default 480 minutes) or the user signs out. |
| 9 | 99.9 percent uptime. | unsupported | none | No uptime measurement or SLO exists. |
| 10 | No PII is processed. | false | none | Orders hold customer emails, so PII is processed. |
| 11 | OIDC with Okta supported. | false | `api/test/oidc-discovery.test.ts`, test `uses endpoints from discovery`; `deploy/keycloak/realm-cic.json` | Only the mock IdP is tested. The Keycloak suite is authored, not run. No Okta or Entra ID test exists. |
| 12 | Rate limiting on all endpoints. | false | `api/src/login-limit.ts`, test `login is rate limited with Retry-After` in `api/test/security-headers.test.ts` | The login endpoints have a rate limit. Other API routes do not. The REST source client waits on HTTP 429 from the source. |
| 13 | Backups tested. | unsupported | none | No backup or restore test exists. |
| 14 | SBOM published for every release. | partly supported | `.github/workflows/security.yml`, `docs/engagement/evidence/sbom-source.cdx.json` | The security workflow generates a CycloneDX SBOM. It has never run on GitHub, and there is no release process. |
| 15 | Zero known vulnerabilities. | false | `docs/engagement/evidence/security-gate-local.txt` | npm audit and Trivy were clean on the run date in the local evidence file. That is not "zero known vulnerabilities". |

## Corrected answer sheet

1. No SOC 2 audit was done. The repo has security controls and evidence files, but no SOC 2 report exists.
2. No GDPR assessment was done. The console processes customer emails, so a data protection review is needed before any compliance statement.
3. Only source credentials are encrypted by the application, with AES-256-GCM envelope encryption. Other tables rely on disk encryption of the platform, and this repo does not prove that.
4. MFA depends on the identity provider. The console does not enforce MFA.
5. No penetration test was done.
6. The audit log is tamper-evident by hash chain, not tamper-proof. A database admin who rewrites the full chain is not detected without an external anchor.
7. The webhook secret is shown once at creation and stored encrypted. No plain secret is stored in `sources` rows.
8. A session keeps its role until it expires (default 480 minutes) or the user signs out.
9. No uptime measurement or SLO exists.
10. Orders hold customer emails, so PII is processed.
11. Only the mock IdP is tested. The Keycloak suite is authored, not run. No Okta or Entra ID test exists.
12. The login endpoints have a rate limit. Other API routes do not. The REST source client waits on HTTP 429 from the source.
13. No backup or restore test exists.
14. The security workflow generates a CycloneDX SBOM. It has never run on GitHub, and there is no release process.
15. npm audit and Trivy were clean on the run date in the local evidence file. That is not "zero known vulnerabilities".
