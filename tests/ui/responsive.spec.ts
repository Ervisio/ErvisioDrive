import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function login(page: Page) {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Email", { exact: true }).fill("ui-owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Disposable UI password 123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3111/");
  await expect(page.getByText("Readme.txt", { exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
test("responsive navigation, touch actions and persistent language", async ({
  page,
}, info) => {
  await login(page);
  await noOverflow(page);
  await fs.mkdir("test-results/screenshots", { recursive: true });
  await page.screenshot({
    path: `test-results/screenshots/${info.project.name}-en.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "File actions" }).first().click();
  const actions = page.getByRole("menu");
  await expect(
    actions.getByRole("menuitem", { name: "Move", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await actions.getByRole("menuitem", { name: "Move", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeVisible();
  await noOverflow(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  if ((page.viewportSize()?.width || 0) < 1024) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  } else
    await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  // The page and header each offer a selector; both reflect the same preference.
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .first()
    .selectOption("it");
  await expect(
    page.getByRole("heading", { name: "Impostazioni", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/screenshots/${info.project.name}-it.png`,
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Lingua", exact: true })
    .first()
    .selectOption("en");
  await page.goto("/docs");
  await page.getByRole("button", { name: "Endpoints", exact: true }).click();
  await noOverflow(page);
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await noOverflow(page);
});
test("create a restricted token in the UI and revoke it", async ({
  page,
  request,
}, info) => {
  const tokenName = "Phone integration " + info.project.name;
  await login(page);
  await page.goto("/tokens");
  await page
    .getByRole("button", { name: "Create API token", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Token name", { exact: true }).fill(tokenName);
  await form
    .getByRole("button", { name: "Read-only preset", exact: true })
    .click();
  await form
    .getByLabel("Resource access", { exact: true })
    .selectOption("selected");
  await form
    .getByLabel("Folder slugs (comma-separated)", { exact: true })
    .fill("documents");
  await noOverflow(page);
  await form
    .getByRole("button", { name: "Create API token", exact: true })
    .click();
  const secretDialog = page.getByRole("dialog"),
    secret = await secretDialog
      .getByLabel("API token secret", { exact: true })
      .inputValue();
  expect(secret.startsWith("edv_")).toBe(true);
  const list = await request.get("/api/v1/files", {
    headers: { Authorization: "Bearer " + secret },
  });
  expect(list.status()).toBe(200);
  const files = (await list.json()).data;
  expect(
    files.every((file: { folder: string }) => file.folder === "documents"),
  ).toBe(true);
  const forbidden = await request.delete(`/api/v1/files/${files[0]._id}`, {
    headers: { Authorization: "Bearer " + secret },
  });
  expect(forbidden.status()).toBe(403);
  await secretDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const card = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: tokenName, exact: true }),
    })
    .last();
  await card.getByRole("button", { name: "Revoke", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(card.getByText("Revoked", { exact: false })).toBeVisible();
  const revoked = await request.get("/api/v1/me", {
    headers: { Authorization: "Bearer " + secret },
  });
  expect(revoked.status()).toBe(401);
});
test("limits, per-person quota and shared-with-me filter", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("ui-admin@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Disposable UI password 123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3111/");

  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Space and limits", exact: true })
    .click();
  const mode = page.getByRole("group", { name: "Quota per person: mode" });
  await mode.getByRole("button", { name: "Limit", exact: true }).click();
  await page.getByRole("textbox", { name: "Quota per person" }).fill("5");
  await noOverflow(page);
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

  await page.goto("/admin");
  const card = page
    .locator(".member-card")
    .filter({ hasText: "ui-owner@example.com" });
  await expect(card.getByText("of 5 GB (default)")).toBeVisible();
  await noOverflow(page);
  const quota = async (choice: RegExp) => {
    await card.getByRole("button", { name: "Quota", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: choice }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await quota(/^Unlimited$/);
  await expect(card.getByText("· unlimited quota")).toBeVisible();
  await quota(/^Default/);
  await expect(card.getByText("of 5 GB (default)")).toBeVisible();

  await card.getByRole("link", { name: "Browse files", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "You are viewing the space of" }),
  ).toBeVisible();
  await expect(page.getByText("Readme.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to my drive", exact: true }).click();
  await page
    .getByRole("button", { name: "Shared with me", exact: true })
    .click();
  await expect(page).toHaveURL(/scope=shared/);
  await expect(
    page.getByRole("button", { name: "Shared with me", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
