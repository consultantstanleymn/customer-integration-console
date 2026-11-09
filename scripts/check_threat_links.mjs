#!/usr/bin/env node
// Check that each test name in the threat model table exists in the test folders.
// A row that waits for a later packet uses "planned: CON-NN" in place of a test name.
// Exit 1 when a test name is missing and is not marked planned.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const TEST_DIRS = ["api/test", "mocks/test", "web/test", "test", "e2e"];
const PLANNED = /^planned:\s*CON-\d+$/;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function loadTestText(root) {
  const files = [];
  for (const dir of TEST_DIRS) {
    files.push(...walk(join(root, dir)));
  }
  const parts = [];
  for (const file of files) {
    try {
      parts.push(readFileSync(file, "utf8"));
    } catch {
      // Skip unreadable files.
    }
  }
  return parts.join("\n");
}

function splitRow(line) {
  const cells = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "`") {
      inCode = !inCode;
      cell += ch;
      continue;
    }
    if (ch === "|" && !inCode) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: node scripts/check_threat_links.mjs <threat-model.md>");
    process.exit(2);
  }
  const modelPath = resolve(arg);
  const root = process.cwd();
  const text = readFileSync(modelPath, "utf8");
  const testText = loadTestText(root);

  const lines = text.split(/\r?\n/);
  const missing = [];
  const planned = [];
  let rows = 0;

  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    // Drop the empty first and last cell from the leading and trailing pipes.
    const body = cells.slice(1, cells.length - 1);
    if (body.length < 7) continue;
    const id = body[0];
    if (!/^T-\d+$/.test(id)) continue;
    rows++;
    const testCell = body[5] ?? "";
    const name = testCell.replace(/`/g, "").trim();
    if (!name) {
      missing.push({ id, name: "(empty)" });
      continue;
    }
    if (/^risk decision$/i.test(name)) {
      continue;
    }
    if (PLANNED.test(name)) {
      planned.push({ id, name });
      continue;
    }
    if (!testText.includes(name)) {
      missing.push({ id, name });
    }
  }

  console.log(`rows checked: ${rows}`);
  if (planned.length > 0) {
    console.log(`planned rows: ${planned.length}`);
    for (const p of planned) {
      console.log(`  ${p.id}: ${p.name}`);
    }
  }
  if (missing.length > 0) {
    console.log(`missing test names: ${missing.length}`);
    for (const m of missing) {
      console.log(`  ${m.id}: ${m.name}`);
    }
    process.exit(1);
  }
  console.log("all test names found");
}

main();
