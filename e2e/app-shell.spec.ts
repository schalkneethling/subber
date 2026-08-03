import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("application shell", () => {
  test("loads its primary content without browser errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("exposes a stable semantic structure", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - heading [level=1]
    `);
  });

  test("offers a visible skip link as the first keyboard target", async ({ page }) => {
    await page.goto("/");

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");

    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toBeInViewport();

    await skipLink.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("has no automatically detectable WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("matches the reviewed application-shell baseline", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    await expect(page.locator("[data-app-shell]")).toHaveScreenshot("application-shell.png");
  });
});
