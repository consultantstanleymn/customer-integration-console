# Review guide

This guide walks a reviewer through the console in about 60 minutes. It covers the FoodDistCo security review. The customer asked three questions:

1. Who can change a pipeline?
2. Who can see customer emails?
3. Can you prove it?

Every claim below points to a file. Read the file before you accept the claim.

## 1. Pitch (5 minutes)

FoodDistCo loads order data from three sources: a CSV upload, a rate-limited REST API, and a signed webhook. Their security team wants proof of control. This console answers the three questions with code, tests and documents:

- **Who can change a pipeline?** Roles are `viewer < engineer < admin`. A route table declares the role for each route. A generated test calls every route as each role and checks the status. See `api/src/routes.ts`, `api/src/app.ts` and `api/src/authz-expected.ts`.
- **Who can see customer emails?** Source credentials are encrypted at rest with envelope encryption. List output masks secret fields. See `api/src/secrets/envelope.ts`.
- **Can you prove it?** The audit log has a hash chain. An export command and a verify command detect a tampered row. See `api/src/audit-chain.ts`.

The threat model, the risk decision and the governance correction close the loop. See `docs/engagement/THREAT-MODEL.md`, `docs/engagement/RISK-DECISION.md` and `docs/engagement/governance/CORRECTION.md`.

## 2. Demo steps (25 minutes)

Run the steps in order. Each step prints a result you can show.

1. Start the local stack:
   ```
   npm run stack
   ```
   Wait until the API and the web app answer. Keep this terminal open.

2. Run the authorization matrix. It calls every route as anonymous, viewer, engineer and admin:
   ```
   npm run authz-matrix -w api
   ```
   Expected: all cases pass. A route without a matrix entry fails the run.

3. Run the token negative tests. Expired, wrong audience, wrong issuer, unknown `kid`, tampered signature, `alg: none`, HS256 with the public key, replayed code, missing nonce and wrong nonce are all rejected and audited:
   ```
   npx vitest run api/test/token-negative.test.ts
   ```

4. Run the audit chain tamper test:
   ```
   npx vitest run api/test/audit-chain.test.ts
   ```
   Expected: the test edits one row, the verify command reports the break, and the test passes.

5. Export the audit log and verify it:
   ```
   npm run audit:export -w api -- --out /tmp/audit.jsonl
   npm run audit:verify -w api -- --in /tmp/audit.jsonl
   ```
   Expected: the verify command prints the row count and "ok". Edit one line of `/tmp/audit.jsonl` and run verify again. It reports the first bad row.

6. Rotate the source key. First create the new key in the secret provider and set the environment variables. See section 7 of `docs/RUNBOOK.md`. Then run:
   ```
   npm run rotate -w api -- --to <kid>
   ```
   Expected: one audit row with action `secrets.rotated`. A second run skips rows that already use the new key id.

7. Show the security gate evidence. Open `docs/engagement/SECURITY-GATE.md` and `docs/engagement/evidence/security-gate-local.txt`. The gate covers CodeQL, secret scan, image scan, dependency audit, SBOM and the exceptions file.

## 3. Likely questions (20 minutes)

**Q1. How does login work?**
The API builds an authorize URL, exchanges the code at the token endpoint, and verifies the ID token with the issuer, the audience and the nonce. See `api/src/auth.ts`.

**Q2. What stops a forged token?**
Signature check against the JWKS, issuer check, audience check, nonce check and an algorithm allow list. The negative tests cover each case. See `api/test/token-negative.test.ts`.

**Q3. What happens on an unknown `kid`?**
The key lookup fails and the request is rejected. The rejection is audited. See `api/src/auth.ts`.

**Q4. How is a role enforced?**
Each route declares `auth`. The hook in `api/src/app.ts` compares the user role with the route role through `canAccess`. See `api/src/auth.ts`.

**Q5. How do you know a new route is covered?**
The matrix test reads the route table and the expected table. A route without an entry fails the run. See `api/src/authz-expected.ts`.

**Q6. Can a viewer change a pipeline?**
No. Write routes require engineer or admin. The matrix test proves it for every route.

**Q7. How are source credentials stored?**
As ciphertext in `sources.config`. A data key encrypts the value. A key encryption key wraps the data key. See `api/src/secrets/envelope.ts`.

**Q8. Where do keys come from?**
A secret provider port. The env adapter and the file adapter are real. The GCP Secret Manager adapter is tested with a fake. See `api/src/secrets/envelope.ts`.

**Q9. What happens during rotation?**
New writes use the new key id. Old rows decrypt during the grace window. The rotate command re-encrypts every row. See section 7 of `docs/RUNBOOK.md`.

**Q10. How does the audit chain work?**
Each row stores a hash of the previous row and its own content. A change to one row breaks every later hash. See `api/src/audit-chain.ts`.

**Q11. Can an attacker delete audit rows?**
A trigger blocks UPDATE and DELETE on `audit_log`. See `api/migrations/001_init.sql`. The chain is tamper-evident, not tamper-proof. A database owner can still drop the table.

**Q12. How do you verify the chain?**
Export to a file, then run the verify command. It recomputes the chain and reports the first bad row. See `api/src/audit-chain.ts`.

**Q13. How is login rate limited?**
A limiter counts attempts per address and per subject. Over the limit returns 429. See `api/src/login-limit.ts`.

**Q14. What are the security headers?**
The API and the web app send a strict transport header, a content type guard, a frame guard and a content security policy. See `api/src/app.ts` and the web header test.

**Q15. What is the threat model?**
A STRIDE table with a data-flow diagram and trust boundaries. Each threat links to a control and a test, or to the risk decision. See `docs/engagement/THREAT-MODEL.md`.

**Q16. What risk did you accept?**
One record with an owner, a review date and compensating controls. See `docs/engagement/RISK-DECISION.md`.

**Q17. What did the governance draft get wrong?**
A line-by-line correction with a verdict and a file path for each claim. See `docs/engagement/governance/CORRECTION.md`.

**Q18. What does the CI gate run?**
CodeQL, a secret scan, an image scan, a dependency audit, an SBOM and an exceptions file with owner and expiry. See `docs/engagement/SECURITY-GATE.md`.

**Q19. How do machine clients get access?**
Client credentials grant with scopes `runs:start` and `sources:read`. A token without the scope gets 403. See `api/test/machine-scopes.test.ts`.

**Q20. Can the suite run against a real IdP?**
Yes. A Keycloak compose profile and a realm file exist. The suite is authored but not run on this laptop. See `api/test/oidc-heldout.test.ts` and `deploy/keycloak/realm-cic.json`.

## 4. Remaining risks

Read these before you sign off. Each item is a real gap.

- The Keycloak suite is authored, not run. The mock IdP covers unit tests only.
- The GCP Secret Manager adapter is tested with a fake. No live project was used.
- The CI jobs never ran on the hosted service. The local commands pass.
- Test numbers were measured on one laptop. Counts can differ on other hardware.
- The content security policy allows inline scripts. This is a known weakening.
- The login limiter shares one address behind the proxy. Many users behind one proxy share a bucket.
- The audit chain is tamper-evident, not tamper-proof. A database owner can drop the table.
- Only source credentials are encrypted by the app. Other columns are plain text.
