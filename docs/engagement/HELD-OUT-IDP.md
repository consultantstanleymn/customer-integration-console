# Held-out identity provider: why a second one matters

label: ENGAGEMENT EVIDENCE
date: 2026-11-09
code commit: n/a (document)
criterion: C-4
status: authored, not run (Keycloak); met locally (discovery against mock)
---

## Purpose

FoodDistCo asks one question: can the login and role checks run against a real identity provider, not only against our own mock? This document answers that question. It also states the limits of the proof.

## Why a second identity provider matters

The mock identity provider is code that we wrote. It shares our assumptions. If our code reads a token field in the wrong way, the mock can make the same mistake. A test against the mock then passes and hides the defect.

A second identity provider is independent code. It publishes its own discovery document and its own key set. It signs tokens with its own keys. It applies its own rules for audience, issuer and nonce. A test against it shows that our login path works with a provider that we do not control.

## What the mock proves

The mock proves these points:

- Our code reads the discovery document at `/.well-known/openid-configuration`.
- Our code fetches the key set from the `jwks_uri` in that document.
- Our code checks the issuer and the audience of the access token.
- Our code checks the nonce in the identity token.
- Our code maps a subject to a local user and a local role.
- The role check `viewer < engineer < admin` works for each role.

The mock test file is `api/test/oidc-heldout.test.ts`. The discovery part of that file runs against the mock. The mock publishes discovery and keys, as shown by the test "publishes discovery and keys" in `mocks/test/mocks.test.ts`.

## What the Keycloak suite would prove

The Keycloak suite would prove these points:

- Our code works with a provider that we did not write.
- Our code works with a real key rotation and a real key identifier.
- Our code works with the token claims that a widely used provider sends.
- The role mapping works with groups and roles that an administrator sets in a real provider.
- The login flow works end to end through a browser redirect.

The suite is authored in `api/test/oidc-heldout.test.ts`. The realm import file is `deploy/keycloak/realm-cic.json`. The suite is not run in this working tree. The status is "authored, not run".

## Exact steps for the owner to run the suite

1. Start the compose profile that holds Keycloak:
   `docker compose --profile keycloak up -d`
2. Wait until the discovery endpoint answers:
   `curl -fsS http://localhost:8081/realms/cic/.well-known/openid-configuration`
3. Import the realm if the profile does not import it:
   `deploy/keycloak/realm-cic.json`
4. Set the environment variables for the test run:
   - `OIDC_HELDOUT_ISSUER=http://localhost:8081/realms/cic`
   - `OIDC_HELDOUT_CLIENT_ID=cic-api`
   - `OIDC_HELDOUT_CLIENT_SECRET=<value from the realm file>`
5. Run the suite:
   `npx vitest run api/test/oidc-heldout.test.ts`
6. Store the command output in `docs/engagement/evidence/oidc-heldout.txt`.
7. Change the C-4 status in `docs/engagement/ACCEPTANCE.md` only after a clean run.

## What neither test proves

Neither test proves these points:

- It does not prove that a commercial identity provider works. Each commercial provider has its own claim names, its own group model and its own policy engine. A test against Keycloak does not cover them.
- It does not prove that the customer tenant is configured in a safe way. Tenant policy, conditional access and session lifetime are set by the customer.
- It does not prove that the browser flow is safe against every attack. The browser flow needs its own review.
- It does not prove that the mock and Keycloak agree on every edge case. A difference between them is a finding, not a pass.

## Status

C-4 status: authored, not run (Keycloak); met locally (discovery against mock).
