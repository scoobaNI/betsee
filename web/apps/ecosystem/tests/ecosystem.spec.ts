import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const clientModule = `/@fs${fileURLToPath(new URL("../../../packages/api/src/client.ts", import.meta.url))}`;

async function launch(page: Page, act: string) {
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await page.evaluate(
    async ({ moduleUrl, scenario }) => {
      const { demoApi } = await import(moduleUrl);
      await demoApi.launch(scenario);
    },
    { moduleUrl: clientModule, scenario: act },
  );
}

test("home presents the complete ecosystem and loads fonts and icons offline", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))
      external.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "See every agent." }),
  ).toBeVisible();
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  for (const product of [
    "Director",
    "Gateway",
    "Policy Studio",
    "Identity",
    "Connect",
    "Approvals",
  ])
    await expect(
      page.getByRole("heading", { name: product, exact: true }),
    ).toBeVisible();
  await expect(page.locator("#gateway-health").locator("svg")).toHaveCount(16);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({
    path: `/tmp/betsee-f16-home-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("catalog exposes real controls, ASI filtering, attachment points and Cedar policies", async ({
  page,
}) => {
  await page.goto("/policy-studio/controls");
  await expect(
    page.getByRole("heading", { name: "Controls catalog" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filter by ASI risk" })
    .selectOption("ASI03");
  await expect(
    page.getByText("Session bound to its agent", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "CTL-ID-001", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Attachment points", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "forbid-session-not-bound-to-agent",
      exact: true,
    })
    .click();
  await expect(page.locator("pre")).toContainText("forbid");
  await expect(page.locator("pre")).toContainText("context.session");
});

test("agent detail shows delegation intersection and use case limits", async ({
  page,
}) => {
  await page.goto("/identity/agents/invoice-assistant");
  await expect(
    page.getByRole("heading", { name: "What this agent can do" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Effective = delegated to the agent ∩ permitted by policy for the use case",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", {
      name: "Permitted for Invoice processing",
    }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("payments.transfer");
  await expect(
    page.getByText("mock model (demo)", { exact: true }),
  ).toBeVisible();
});

test("connect labels the mock model and unconfigured provider adapters", async ({
  page,
}) => {
  await page.goto("/connect/connectors");
  await expect(
    page.getByRole("heading", { name: "Anthropic direct" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Commercial provider adapter. API key is not configured for this demo.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("mock model (demo)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Tools", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "payments", exact: true }),
  ).toBeVisible();
});

test("approvals show the exact action and cannot claim mock MFA", async ({
  page,
}) => {
  await page.goto("/approvals");
  await expect(
    page.getByText("Nothing is waiting for a human.", { exact: true }),
  ).toBeVisible();
  await launch(page, "act5-human-decides");
  await expect(
    page.getByRole("heading", {
      name: "Parameters as received by the Gateway",
    }),
  ).toBeVisible();
  await expect(page.getByText("48,000.00 EUR", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Nordwind Freight GmbH", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve with step-up", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Mock data cannot verify MFA",
  );
  await expect(
    page.getByRole("button", { name: "Reject", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    page.getByText("Nothing is waiting for a human.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Decided", exact: true }).click();
  await expect(
    page.getByText("Rejected by Daniel Ortiz", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Decided", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "Pending", exact: true }),
  ).not.toHaveAttribute("aria-current");
});

test("AI-tightened approval carries its model label and resolves through the shared stream", async ({
  page,
}) => {
  await page.goto("/approvals");
  await launch(page, "act3-hijacked-goal");
  await expect(
    page.getByRole("heading", {
      name: "Parameters as received by the Gateway",
    }),
  ).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("AI-tightened", { exact: true })).toBeVisible();
  await expect(
    page.getByText("mock model (demo)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("Nothing is waiting for a human.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Decided", exact: true }).click();
  await expect(
    page.getByText("Approved by Daniel Ortiz", { exact: false }),
  ).toBeVisible();
});

test("a Gateway failure shows the real HTTP detail and Retry recovers", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await page.evaluate(async (moduleUrl) => {
    const { configureApi, apiConfig } = await import(moduleUrl);
    const previous = apiConfig().fetch;
    let failures = 0;
    configureApi({
      fetch: async (request: Request) => {
        if (
          new URL(request.url).pathname === "/api/v1/policies" &&
          failures++ < 2
        )
          return new Response(
            JSON.stringify({
              error: "unavailable",
              message: "HTTP 503 from the Gateway",
              trace_id: "test-failure-trace",
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          );
        return previous(request);
      },
    });
  }, clientModule);
  await page.getByRole("link", { name: "Policy Studio", exact: true }).click();
  await page.getByRole("link", { name: "Policies", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load policies",
  );
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  await expect(page.getByRole("alert")).toContainText("test-failure-trace");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("pre")).toContainText("context.session");
});
