import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// One stack, one story, in order. SCREENSHOTS=1 also saves the images used in the README.
test.describe.configure({ mode: "serial" });

const root = path.join(import.meta.dirname, "..");
const sample = (f: string) => path.join(root, "sample-data", f);
const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: path.join(root, "docs", "img", `${name}.png`), fullPage: true });
};

async function loginAs(page: Page, name: "Alice" | "Bob" | "Carol") {
  await page.goto("/login");
  await page.getByTestId("sso-login").click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("whoami")).toContainText(name);
}

test("anonymous visitors are sent to the sign-in page", async ({ page }) => {
  await page.goto("/sources");
  await expect(page).toHaveURL(/\/login$/);
  await shot(page, "login");
});

test("engineer builds three connectors and runs them", async ({ page }) => {
  await loginAs(page, "Bob");
  await page.goto("/sources");

  // CSV connector
  await page.getByLabel("Name").fill("orders-csv");
  await page.getByRole("button", { name: "Create source" }).click();
  await expect(page.getByTestId("source-orders-csv")).toBeVisible();
  await page.getByLabel("Upload CSV to orders-csv").setInputFiles(sample("orders_good.csv"));
  await expect(page.getByRole("status")).toContainText("5 in, 5 loaded, 0 failed");
  await page.getByLabel("Upload CSV to orders-csv").setInputFiles(sample("orders_with_errors.csv"));
  await expect(page.getByRole("status")).toContainText("5 in, 1 loaded, 3 failed");

  // REST connector (mock API with pagination and rate limit)
  await page.getByLabel("Name").fill("shop-api");
  await page.getByLabel("Type").selectOption("rest");
  await page.getByLabel("Base URL").fill(process.env.E2E_SOURCE!);
  await page.getByLabel("API key").fill("demo-key");
  await page.getByRole("button", { name: "Create source" }).click();
  await expect(page.getByTestId("source-shop-api")).toBeVisible();
  await page.getByTestId("source-shop-api").getByRole("button", { name: "Run now" }).click();
  await expect(page.getByRole("status")).toContainText("120 in", { timeout: 30_000 });

  // Webhook connector
  await page.getByLabel("Name").fill("shop-events");
  await page.getByLabel("Type").selectOption("webhook");
  await page.getByRole("button", { name: "Create source" }).click();
  await expect(page.getByRole("status")).toContainText("Secret (shown once)");
  await shot(page, "sources");
});

test("dead letters can be fixed and replayed", async ({ page }) => {
  await loginAs(page, "Bob");
  await page.goto("/dead-letters");
  const cards = page.getByTestId("dead-letter");
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  expect(before).toBeGreaterThan(3);
  await shot(page, "dead-letters");
  const card = cards.filter({ hasText: "E-2002" });
  const box = card.getByRole("textbox");
  await box.fill((await box.inputValue()).replace("not-an-email", "iris@shop.test"));
  await card.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("status")).toContainText("1 row loaded");
  await expect(cards).toHaveCount(before - 1);
});

test("dashboard shows runs, charts, quality and connector health", async ({ page }) => {
  await loginAs(page, "Bob");
  await page.goto("/");
  await expect(page.getByTestId("runs-table").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Bar chart/ }).locator("svg").first()).toBeVisible();
  await expect(page.getByTestId("quality-card").first()).toBeVisible();
  await expect(page.getByText("schema_drift").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "needs attention" }).first()).toBeVisible();
  await shot(page, "dashboard");
});

test("schema drift shows up in the scorecard", async ({ page }) => {
  await loginAs(page, "Bob");
  await page.goto("/sources");
  await page.getByLabel("Name").fill("drift-csv");
  await page.getByRole("button", { name: "Create source" }).click();
  await page.getByLabel("Upload CSV to drift-csv").setInputFiles(sample("orders_drifted.csv"));
  await expect(page.getByRole("status")).toContainText("2 loaded");
  await page.goto("/");
  await expect(page.getByTestId("quality-card").filter({ hasText: "drift-csv" })).toContainText("unexpected: [discount_code]");
});

test("viewer is read-only and cannot open the audit log", async ({ page }) => {
  await loginAs(page, "Carol");
  await page.goto("/sources");
  await expect(page.getByRole("form", { name: "Create source" })).toHaveCount(0);
  await expect(page.getByText("can view sources but not change them")).toBeVisible();
  await page.goto("/dead-letters");
  await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);
  await page.goto("/audit");
  await expect(page.getByText("The audit log is for admins only.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
});

test("admin sees the audit trail, including the denied attempts", async ({ page }) => {
  await loginAs(page, "Alice");
  await page.goto("/audit");
  const table = page.getByTestId("audit-table");
  await expect(table).toContainText("auth.login");
  await expect(table).toContainText("csv.upload");
  await expect(table).toContainText("deadletter.replay");
  await expect(table).toContainText("source.create");
  await shot(page, "audit");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
