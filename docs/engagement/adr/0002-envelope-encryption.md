# ADR 0002: Envelope encryption for source credentials

## Status

Accepted.

## Context

The `sources` table stores source credentials in a JSON `config` column. The keys are `secret` and `apiKey`. A database dump must not show these values in clear text. The secret provider holds the key material. The provider can be env, file or GCP Secret Manager.

## Options

1. Store plain values in the `config` column. Simple, but a dump shows the secrets.
2. Use database-level `pgcrypto`. The database holds the key. A dump with the key still shows the secrets. The key sits next to the data.
3. Use app-level envelope encryption with a provider key encryption key (KEK). The app makes a random data key for each value. The app wraps the data key with the KEK. The database stores only ciphertext.

## Decision

Use option 3. The app uses AES-256-GCM with a random data key for each value. The app wraps the data key with the KEK from the secret provider. The KEK name is `source-kek-<kid>`. The `kid` names the KEK version. The database stores the ciphertext, the wrapped data key, the nonce and the `kid`.

## Consequences

- The KEK lives in the secret provider, not in the database.
- Rotation re-wraps the data keys. The app does not decrypt and re-encrypt each value.
- The app reads the KEK from the provider once per process start. This is one provider read per process start.
- A lost KEK makes the source credentials unreadable. The provider must keep the KEK safe and backed up.
- The `sources` rows hold no plain secret.
