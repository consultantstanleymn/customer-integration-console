import { describe, expect, it } from "vitest";
import { ago, canWrite, health, pct } from "../lib/format.js";

describe("format helpers", () => {
  it("formats percentages", () => { expect(pct(0.756)).toBe("76%"); expect(pct(1)).toBe("100%"); });
  it("labels connector health", () => {
    expect(health({ last_status: null, pending_dead_letters: 0 }).label).toBe("never run");
    expect(health({ last_status: "failed", pending_dead_letters: 0 }).tone).toBe("bad");
    expect(health({ last_status: "success", pending_dead_letters: 2 }).label).toBe("needs attention");
    expect(health({ last_status: "success", pending_dead_letters: 0 }).label).toBe("healthy");
  });
  it("formats relative time", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    expect(ago("2026-01-01T23:59:30Z", now)).toBe("30s ago");
    expect(ago("2026-01-01T23:00:00Z", now)).toBe("1h ago");
    expect(ago("2025-12-30T00:00:00Z", now)).toBe("3d ago");
    expect(ago(null, now)).toBe("never");
  });
  it("only engineers and admins write", () => {
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite("engineer")).toBe(true);
    expect(canWrite("admin")).toBe(true);
  });
});
