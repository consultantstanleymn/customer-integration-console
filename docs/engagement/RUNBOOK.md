# Engagement runbook

This page adds engagement procedures to `docs/RUNBOOK.md`. Read `docs/RUNBOOK.md` first. It covers stuck runs, schema drift, dead letters, failed runs, sign-in problems, alerts and key rotation.

The procedures below use the API workspace scripts. Run them from the repo root.

## 1. Rotate the source key

The full procedure is section 7 of `docs/RUNBOOK.md`. This is the short form.

1. Create the new key encryption key in the secret provider under `source-kek-<new-kid>`. Use 32 random bytes in base64.
2. Set `SOURCE_KEK_ACTIVE=<new-kid>` on the API.
3. Set `SOURCE_KEK_PREVIOUS` to the old key ids, comma separated.
4. Set `SOURCE_KEK_GRACE_UNTIL` to an ISO date.
5. Restart the API.
6. Run the rotation command:
   ```
   npm run rotate -w api -- --to <new-kid>
   ```
7. Run the command again. Rows that already use the new key id are skipped.
8. Check the audit log for action `secrets.rotated`.
9. After the grace date, remove the old key ids and delete the old key in the secret provider.

## 2. Verify the audit chain

1. Export the audit log to a file:
   ```
   npm run audit:export -w api -- --out /tmp/audit.jsonl
   ```
2. Verify the file:
   ```
   npm run audit:verify -w api -- --in /tmp/audit.jsonl
   ```
3. Read the result. "ok" means the chain is intact. A bad row number means the chain broke at that row.
4. Keep the exported file as evidence. Store it where the database owner cannot change it.
5. If the chain breaks, treat it as an incident. The trigger blocks UPDATE and DELETE, so a break means a schema change, a restore, or direct table access.

## 3. Tune the login rate limit

1. Set `LOGIN_RATE_PER_MIN` on the API. The default is in `api/src/login-limit.ts`.
2. Restart the API.
3. Watch the login attempts. A 429 means the limiter blocked the attempt. The response has a retry hint.
4. A 429 for a real user usually means a shared address. The limiter counts per address and per subject.
5. Known gap: behind the proxy, many users share one address. They share one bucket. Raise the limit or key the limiter on the subject only. Check `trustProxy` in the API config before you change the address source.

## 4. Run the Keycloak held-out suite

This suite is authored but not run on this laptop. The owner must pull the image first.

1. Pull the Keycloak image on a machine with network access.
2. Set `KC_ADMIN_PASSWORD` if you want a fixed admin password. It is optional.
3. Run the script:
   ```
   ./scripts/keycloak-heldout.sh
   ```
4. The script starts the compose profile, imports `deploy/keycloak/realm-cic.json`, and runs `api/test/oidc-heldout.test.ts` against the discovery endpoint.
5. Read the output. A discovery failure means the realm did not import. Check the container logs.
6. Stop the profile when the run ends.

## 5. Add a machine client

1. Add the client to the mock IdP client list in `mocks/src/oidc.ts`. Use the client credentials grant.
2. Grant the scopes the client needs. The console uses `runs:start` and `sources:read`.
3. Map each scope to the routes that accept it. A route that needs `runs:start` is a run start route. A route that needs `sources:read` is a source read route.
4. Add a test case to `api/test/machine-scopes.test.ts`. Cover the token with the scope and the token without it.
5. Run the test:
   ```
   npx vitest run api/test/machine-scopes.test.ts
   ```
6. A token without the scope must get 403. If it gets 200, the route check is missing.
