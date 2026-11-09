# ADR 0004: Machine client access with OAuth2 client credentials and scopes

## Status

Accepted.

## Context

An ETL runner must start pipeline runs and read sources without a human login. The runner needs a narrow set of rights. The console must audit each machine call. The scopes are `runs:start` and `sources:read`.

## Options

1. Use API keys. Simple, but a key is a long-lived shared secret. It has no standard expiry and no standard scope model.
2. Use mTLS. Strong client identity, but it needs certificate management for each client.
3. Use OAuth2 client credentials with scopes. The IdP issues a short-lived access token with scopes. The API checks the scope on each route.

## Decision

Use option 3. A machine client gets an access token from the IdP with the client credentials grant. The token carries scopes. Only routes with a scopes list accept machine tokens. A token without the needed scope gets 403. Machine calls skip the CSRF check, because a machine client has no browser session. The audit log records the actor as `client:<sub>` with role `machine`.

## Consequences

- Each machine client has a short-lived token with a narrow scope set.
- A route without a scopes list rejects machine tokens. This is the safe default.
- The IdP must issue client credentials tokens with the right scopes.
- The audit log shows machine calls with a `client:` actor prefix.
- The team must rotate client secrets in the secret provider.
