# Acceptance criteria: FoodDistCo integration console

label: ENGAGEMENT PLAN
date: 2026-11-09
code commit: f79dd554165f10dc68be1f0684ab798153ac4550
machine: Linux 7.2.8, 8 logical CPUs, 16 GB RAM, Fedora 44
command: grep -c '^| C-' docs/engagement/ACCEPTANCE.md
notes: The table holds 11 criteria. A status of "not started" means the check has not yet passed in this working tree.
---

## How to read this table

- Criterion: what the customer requires.
- Measurable check: the exact pass condition.
- Proof: the file or command named for the criterion.
- Evidence: where the result is stored.
- Status: not started, met locally, authored, not run, or not met.

A criterion is "met locally" only when its evidence file exists and the named command has a clean result. A criterion that stays open needs a risk decision record with an owner and a review date.

## Criteria

| ID | Criterion | Measurable check | Proof | Evidence | Status |
|---|---|---|---|---|---|
| C-1 | STRIDE threat model with a data-flow diagram and trust boundaries for the browser, web, API, identity provider, database, source systems and webhook senders. Each threat links to a control and a test, or to a risk decision. | Every test name in the table exists. | `docs/engagement/THREAT-MODEL.md` and the link check script | `docs/engagement/evidence/threat-model-link-check.txt` | not started |
| C-2 | An authorization matrix test is generated from the route table. It calls every route as anonymous, viewer, engineer and admin, and checks the expected status. A route without a matrix entry fails the test run. | `api/test/authz-matrix.test.ts` passes. Adding a fake route fails it. | `api/test/authz-matrix.test.ts` | `docs/engagement/evidence/authz-matrix.md` | not started |
| C-3 | Token tests cover expired, wrong audience, wrong issuer, unknown `kid`, tampered signature, `alg: none`, HS256 signed with the public key, replayed code, missing nonce and wrong nonce. All are rejected and audited. | 10 tests pass. Audit rows exist. | `api/test/token-negative.test.ts` | `docs/engagement/evidence/token-negative.txt` | not started |
| C-4 | Held-out identity provider: the login and RBAC suite can run against Keycloak through a compose profile and discovery. The mock stays for unit tests. | Discovery tests pass against the mock. The Keycloak suite is authored but not run. | `api/test/oidc-heldout.test.ts` and `deploy/keycloak/realm-cic.json` | `docs/engagement/evidence/oidc-heldout.txt` | not started |
| C-5 | Machine clients get client-credentials access tokens with the `runs:start` and `sources:read` scopes. A token without the scope gets 403. | Tests pass. | `api/test/machine-scopes.test.ts` | `docs/engagement/evidence/machine-scopes.txt` | not started |
| C-6 | Secret provider port for environment, file and GCP Secret Manager, with a fake for the adapter. Source credentials are encrypted at rest with envelope encryption. Rotation re-encrypts all rows. Old ciphertext decrypts during the grace window. | Tests pass. No plain secret in `sources` rows. | `api/test/secrets.test.ts` and `api/test/rotation.test.ts` | `docs/engagement/evidence/secrets-rotation.txt` | not started |
| C-7 | The audit log has a hash chain, an export command and a verify command. A tampered row is detected. | The tamper test passes. | `api/test/audit-chain.test.ts` | `docs/engagement/evidence/audit-chain.txt` | not started |
| C-8 | CI security gate: CodeQL, gitleaks, Trivy image scan, `npm audit`, SBOM, and an exceptions file with an owner and an expiry date. | Local commands pass. The workflow is linted. | `docs/engagement/evidence/security-gate-local.txt` | `docs/engagement/evidence/security-gate-local.txt` | not started |
| C-9 | Security headers and a content security policy on the API and the web app. A login rate limit. | Header tests pass. The login returns 429 after the limit. | `api/test/security-headers.test.ts` and `web/test/headers.test.ts` | `docs/engagement/evidence/security-headers.txt` | not started |
| C-10 | One unreviewed governance draft is corrected line by line as supported, partly supported or unsupported, with file evidence. | Every claim has a verdict and a file path. | `docs/engagement/governance/CORRECTION.md` | `docs/engagement/governance/CORRECTION.md` | not started |
| C-11 | One risk decision record with an owner, a review date and compensating controls. | The file exists. | `docs/engagement/RISK-DECISION.md` | `docs/engagement/RISK-DECISION.md` | not started |

## Status rules

1. Record the date and the code commit in each evidence file.
2. Attach the command output to the evidence file.
3. Change not started to met locally only after a clean run.
4. Use not met when a check fails and keep the output.
5. A criterion can stay open only with a risk decision that names the owner, the review date and the compensating controls.
