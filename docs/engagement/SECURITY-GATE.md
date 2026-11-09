# Security gate

This file describes the security checks of the console. It lists what each job checks, how to run it on a laptop, and what is proven.

## Jobs in `.github/workflows/security.yml`

| Job | What it checks | Fail rule | Local command |
|---|---|---|---|
| `codeql` | Static analysis of TypeScript and JavaScript. | Any error-level result. | None. CodeQL needs GitHub Actions. |
| `secrets` | gitleaks over the full git history. | Any finding. | `gitleaks git --config .gitleaks.toml --redact --no-banner --exit-code 1 .` |
| `deps` | `npm audit` for production dependencies. A full audit runs as a warning. | HIGH or CRITICAL with a fix. | `npm audit --audit-level=high --omit=dev` |
| `image` | Trivy scan of the api, web and mocks images. | HIGH or CRITICAL with a fix. | `trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 <image>` |
| `sbom` | CycloneDX SBOM of the source tree and the api image. | Job error. | `trivy fs --format cyclonedx --output docs/engagement/evidence/sbom-source.cdx.json .` |
| `exceptions` | Checks `security/exceptions.json`. | A missing field or an expired date. | `python3 scripts/check_security_exceptions.py security/exceptions.json` |

The file `.semgrep.yml` holds four local rules for TypeScript. Run it with `semgrep --config .semgrep.yml --metrics=off --error api/src mocks/src web/app web/lib`.

## Exceptions

An accepted finding goes into `security/exceptions.json`. Each item has an id, a tool, a reason, an owner, an expiry date (90 days at most) and a review note. An item that has not expired does not fail the job. The list is empty today.

## Status

| Check | Status |
|---|---|
| gitleaks, history and tree | Ran on this laptop. No findings. |
| npm audit (production) | Ran on this laptop. 0 vulnerabilities. |
| Trivy image scan, three images | Ran on this laptop. See `evidence/security-gate-local.txt`. |
| CycloneDX SBOM | Ran on this laptop. See `evidence/sbom-source.cdx.json`. |
| Semgrep rules | Ran on this laptop. No findings. |
| `security.yml` workflow | Authored, not run. It passes `actionlint`. It never ran on GitHub. |
| CodeQL | Authored, not run. It needs GitHub Actions. |

Action versions are unverified until a run.

## Image finding fixed

The first image scan found HIGH findings in the copy of `npm` that ships with the `node:22-alpine` base image. The runtime images do not use `npm`. Each runtime stage now removes it. The second scan was clean.
