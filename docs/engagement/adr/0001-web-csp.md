# ADR 0001: Web Content-Security-Policy

## Status

Accepted.

## Context

The web console serves the analyst UI. The security review asks for a Content-Security-Policy (CSP) on the web app. The app is built with Next.js. Next.js inlines small bootstrap scripts into the HTML. A strict nonce CSP needs middleware that adds a nonce to each response and to each script tag. The current Next.js version does not support this out of the box in a simple way.

## Options

1. Strict nonce CSP. Strongest option. It blocks inline script injection. It needs middleware nonce support and a change to the build. Cost is high for this release.
2. Static CSP with 'unsafe-inline' for script and style. It works with the built app today. It does not block inline script injection.
3. No CSP. It gives no defense in depth. The review rejects this option.

## Decision

Use option 2. The web app sends this static CSP:

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

In development only, the app adds 'unsafe-eval' to script-src for hot reload. The production value never contains 'unsafe-eval'.

The app also sends these headers: X-Content-Type-Options nosniff, Referrer-Policy no-referrer, X-Frame-Options DENY.

## Consequences

- Inline script injection is not blocked by CSP. Other controls reduce this risk:
  - The JSON API sends no CSP and returns JSON only.
  - React escapes output by default.
  - A rule in .semgrep.yml flags dangerouslySetInnerHTML.
  - frame-ancestors 'none' and X-Frame-Options DENY block framing.
  - base-uri 'self' and form-action 'self' limit base tag and form hijack.
- The 'unsafe-inline' trade-off is recorded here for the vendor security review.

## Reopen trigger

Reopen this ADR when the team adopts Next.js middleware nonce support. Then move to a strict nonce CSP and remove 'unsafe-inline' from script-src.
