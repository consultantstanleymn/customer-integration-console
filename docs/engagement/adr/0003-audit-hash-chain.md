# ADR 0003: Audit hash chain

## Status

Accepted.

## Context

The audit log must show who changed a pipeline and when. A database admin can edit a row. The `audit_log` table has a trigger `audit_log_no_change` that blocks UPDATE and DELETE. A direct edit with owner rights can still bypass the trigger. The console needs tamper evidence.

## Options

1. Use the database trigger only. It blocks normal edits. It does not detect an edit with owner rights.
2. Use a hash chain. Each row holds the hash of the prior row and its own content. A verify command walks the chain.
3. Use an external ledger. Strong evidence, but it adds a new service and a new failure mode.

## Decision

Use option 2. Each audit row holds a hash of the prior row hash and its own content. The writer takes a Postgres advisory lock, so two writers cannot fork the chain. The console has an export command and a verify command. The verify command reports the first bad row.

## Consequences

- The chain is tamper-evident, not tamper-proof. A database admin can still edit a row.
- A full rewrite of the whole chain is not detected without an external anchor of the last hash. The team must publish or store the last hash outside the database to close this gap.
- The advisory lock serializes audit writes. This is a small cost on write throughput.
- The export command gives the security team a copy of the chain for review.
