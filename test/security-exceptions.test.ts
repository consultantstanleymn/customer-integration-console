// Runs the security exceptions checker on good, expired and incomplete files.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const checker = fileURLToPath(new URL("../scripts/check_security_exceptions.py", import.meta.url));
const exceptionsFile = fileURLToPath(new URL("../security/exceptions.json", import.meta.url));

type RunResult = { status: number; output: string };

function run(file: string): RunResult {
  try {
    const output = execFileSync("python3", [checker, file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function item(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    id: "EX-001",
    tool: "npm audit",
    reason: "The finding has no fix in the current release.",
    owner: "Stanley Sujith Nelavala",
    expires: isoDate(30),
    review_note: "Review when the next minor release lands.",
    ...overrides,
  };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "security-exceptions-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("security exceptions checker", () => {
  it("accepts a valid file", () => {
    const file = join(dir, "good.json");
    writeFileSync(file, JSON.stringify([item()], null, 2));
    const result = run(file);
    expect(result.status).toBe(0);
    expect(result.output).toContain("OK");
  });

  it("accepts the repository exceptions file", () => {
    const result = run(exceptionsFile);
    expect(result.status).toBe(0);
  });

  it("rejects an expired item", () => {
    const file = join(dir, "expired.json");
    writeFileSync(file, JSON.stringify([item({ expires: isoDate(-1) })], null, 2));
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.output).toContain("expired");
  });

  it("rejects an item with a missing field", () => {
    const file = join(dir, "missing.json");
    const bad = {
      id: "EX-002",
      tool: "npm audit",
      reason: "The item has no review note.",
      owner: "Stanley Sujith Nelavala",
      expires: isoDate(30),
    };
    writeFileSync(file, JSON.stringify([bad], null, 2));
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.output).toContain("review_note");
  });
});
