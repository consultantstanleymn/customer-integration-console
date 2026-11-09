import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "../next.config";

function headerValue(key: string): string | undefined {
  return securityHeaders.find((h) => h.key === key)?.value;
}

describe("web security headers", () => {
  it("sets the four required headers", () => {
    expect(headerValue("Content-Security-Policy")).toBeTruthy();
    expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("Referrer-Policy")).toBe("no-referrer");
    expect(headerValue("X-Frame-Options")).toBe("DENY");
  });

  it("CSP has the required directives", () => {
    const csp = headerValue("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("production CSP does not allow unsafe-eval", () => {
    const csp = buildCsp(false);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("development CSP allows unsafe-eval for hot reload", () => {
    const csp = buildCsp(true);
    expect(csp).toContain("unsafe-eval");
  });
});
