import { test, expect } from "@playwright/test";

test.describe("QueryPad", () => {
  test("loads with sample data and shows workspace", async ({ page }) => {
    await page.goto("/");

    // Wait for DuckDB to initialize and sample data to load
    await expect(page.locator("text=QueryPad")).toBeVisible({ timeout: 15000 });

    // Sidebar should show sample tables
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "departments", exact: true })).toBeVisible();
  });

  test("executes sample SQL query and shows results", async ({ page }) => {
    await page.goto("/");

    // Wait for workspace to load with sample data
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    // The sample query should be prefilled — click Run button
    await page.getByRole("button", { name: "Run" }).click();

    // Results table should appear with data rows
    await expect(page.getByText("dept_name", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("avg_salary", { exact: true }).last()).toBeVisible();
  });

  test("shows a data profile for a sample table", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Profile employees" }).click();

    await expect(page.getByText("employees profile")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("salary", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Null \d/).first()).toBeVisible();
    await expect(page.getByText(/Distinct/).first()).toBeVisible();
  });

  test("copies agent context with schema and query state", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("dept_name", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Copy context" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    expect(copied).toContain("# QueryPad Context");
    expect(copied).toContain("### employees");
    expect(copied).toContain("### departments");
    expect(copied).toContain("SELECT d.dept_name");
    expect(copied).toContain("## Latest Result");
  });

  test("can switch AI SQL assistant provider", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: /AI/ }).click();
    await expect(page.getByPlaceholder("Enter your Anthropic API key (sk-ant-...)")).toBeVisible();

    await page.getByRole("button", { name: "Use OpenAI" }).click();
    await expect(page.getByPlaceholder("Enter your OpenAI API key (sk-...)")).toBeVisible();

    await page.getByRole("button", { name: "Use Claude" }).click();
    await expect(page.getByPlaceholder("Enter your Anthropic API key (sk-ant-...)")).toBeVisible();
  });

  test("can switch between SQL and Pipeline mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    // Click Pipeline button
    await page.locator("button", { hasText: "Pipeline" }).click();

    // Pipeline editor should appear
    await expect(page.locator("text=Pipeline 1")).toBeVisible();

    // Switch back to SQL
    await page.locator("button", { hasText: "SQL" }).click();
    await expect(page.locator("text=employees")).toBeVisible();
  });

  test("shows welcome banner with sample data", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    // Welcome banner should be visible
    await expect(
      page.locator("text=Exploring with sample data")
    ).toBeVisible();
  });

  test("can clear workspace", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "employees", exact: true })).toBeVisible({ timeout: 15000 });

    // Click Clear button
    await page.locator("button", { hasText: "Clear" }).click();

    // Should show the drop zone (empty state)
    await expect(
      page.getByRole("button", { name: "employees", exact: true })
    ).not.toBeVisible({ timeout: 5000 });
  });
});
