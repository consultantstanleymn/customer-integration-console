Fictional customer. Any match with a real company is not intended.

# Engagement scenario: FoodDistCo integration console

label: ENGAGEMENT SCENARIO
date: 2026-11-09
code commit: n/a (document)
machine: Linux 7.2.8, 8 logical CPUs, 16 GB RAM, Fedora 44
command: none (document)
notes: Fictional customer only. No real customer data.
---

## Purpose

This document sets the scene for the security work on the customer integration console. It is the first part of the engagement record. It tells the reader who the customer is, what data flows through the console, what the security team asks, and what is in scope.

## Customer

FoodDistCo is a regional food distributor. Its analysts load order data from three sources.

| Source | Method | Notes |
|---|---|---|
| CSV upload | An analyst uploads a file from the order desk. | The file holds one order batch. |
| REST API | The console pulls pages from the order system. | The source limits the request rate. The client waits and retries. |
| Signed webhook | The transport partner posts events. | The sender signs each request. The API checks the signature. |

The order data holds customer names, customer email addresses, order lines, amounts and delivery dates.

## The security question

The FoodDistCo security team asks three questions.

1. Who can change a pipeline?
2. Who can see customer emails?
3. Can you prove it?

The team will use the answers in a vendor security review. The review needs evidence. A claim without a test or a file is not enough.

## Goal

The console must pass the FoodDistCo vendor security review. The work must show four things.

1. Access is limited by role on the server.
2. Secrets and customer data are protected.
3. The audit trail is complete and hard to change.
4. Each control has a test and a recorded result.

## People and systems

| Actor or system | Trust zone | What it does |
|---|---|---|
| Browser | User device | Shows the console. Holds the session cookie. |
| Web app | Application | Serves pages. Proxies API calls from the browser. |
| API | Application | Checks sessions and roles. Runs pipelines. Writes audit rows. |
| Identity provider | Identity | Authenticates users. Issues tokens. |
| Database | Data | Stores orders, sources, sessions and audit rows. |
| Source systems | External | The CSV file, the REST API and the webhook sender. |
| Machine client | External | Starts runs and reads sources with a scoped token. |

## Data flow and trust boundaries

The main flows are:

1. The browser calls the web app. This path crosses an untrusted network.
2. The web app calls the API. This path is internal, but the API still checks every request.
3. The API talks to the identity provider. The API trusts a token only after it checks the issuer, the audience, the signature and the nonce.
4. The API calls the source systems. These calls go out of the trust zone, so the source credentials need protection.
5. A source system calls the webhook route. The API trusts the call only after it checks the signature.
6. The API reads and writes the database. This path is private, and the database role has the least privilege it needs.
7. An auditor reads the audit export. This path is read only.

## Roles

| Role | Rank | Can do |
|---|---|---|
| Anonymous | none | Health, login, callback and signed webhook only. |
| Viewer | 1 | Read sources, runs, statistics and dead letters. |
| Engineer | 2 | Viewer actions, plus create sources, upload, run and replay. |
| Admin | 3 | Engineer actions, plus delete sources and read the audit log. |

## Data classes

| Class | Examples | Handling |
|---|---|---|
| Restricted | Source API keys and webhook secrets | Encrypted at rest. Masked in responses. Never logged. |
| Confidential | Customer email addresses and order values | Limited by role. Redacted in logs. |
| Internal | Run status and quality results | Viewer role and above. |
| Audit | Actor, action, target, time and hash | Admin read. Append only. |

## Scope

In scope:

- Login, sessions, roles and server-side authorization.
- Source credentials at rest and during rotation.
- Audit log, hash chain, export and verify.
- Security headers, content security policy and login rate limit.
- Threat model, authorization matrix, token tests and machine scopes.
- CI security gate and exception records.
- One governance draft correction and one risk decision record.

Out of scope:

- Real customer data. All data is synthetic.
- A production identity provider. The work uses a local provider and a held-out provider profile.
- Network controls, host hardening, physical security and employee devices.
- A penetration test or a formal certification.

## Acceptance

The 11 acceptance criteria are in `docs/engagement/ACCEPTANCE.md`. Each criterion has a measurable check and an evidence path. The engagement is complete only when every row is marked Pass or is covered by a signed risk decision.

## Rules for this record

- The customer is fictional. Use no real customer data.
- Write in simple English.
- Refer to evidence by path.
- Do not mark a criterion as passed without a command output or a file.
