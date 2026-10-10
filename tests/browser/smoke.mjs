import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, unlink } from "node:fs/promises";
const base = process.env.FAIRODDS_URL || "http://localhost:3000";
const output = process.env.BROWSER_OUTPUT || "docs/qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: output, size: { width: 1280, height: 800 } },
});
let page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
try {
  const response = await context.request.get(
    `${base}/api/v1/markets?limit=100`,
    { timeout: 60000 },
  );
  assert.equal(response.status(), 200);
  const { markets } = await response.json();
  assert(
    markets.length > 0,
    "A devnet market is needed for this live read test",
  );
  await check("live canonical market list", async () => {
    assert(
      markets.every(
        (m) => m.startTime > 0 && m.poolUnits.every((x) => /^\d+$/.test(x)),
      ),
    );
  });
  const m = markets.find((m) => m.status === "resolved") || markets[0];
  for (const [url, status] of [
    ["/api/v1/markets?limit=0", 400],
    ["/api/v1/markets/not-an-id", 400],
    ["/api/cron/keeper", 401],
  ])
    await check(`${url} rejects invalid / unauthorized requests`, async () => {
      assert.equal((await context.request.get(base + url)).status(), status);
    });
  await check("Actions CORS and public mapping", async () => {
    for (const url of ["/actions.json", `/api/actions/market/${m.id}`]) {
      const r = await context.request.fetch(base + url, { method: "OPTIONS" });
      assert.equal(r.status(), 204);
      assert.equal(r.headers()["access-control-allow-origin"], "*");
    }
    const r = await context.request.get(`${base}/api/actions/market/${m.id}`, {
      timeout: 60000,
    });
    assert.equal(r.status(), 200);
    assert.equal((await r.json()).disabled, true);
    assert.equal(
      r.headers()["x-blockchain-ids"],
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    );
  });
  await check("input validation and body limit", async () => {
    const url = `${base}/api/v1/markets/${m.id}/bet`;
    assert.equal(
      (
        await context.request.post(url, {
          data: { wallet: "invalid", side: 5, amount: "1" },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await context.request.post(url, { data: { padding: "x".repeat(5000) } })
      ).status(),
      413,
    );
  });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  await check("English home without wallet", async () => {
    await page
      .getByRole("heading", { name: "Your side. Your stake." })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Select Wallet", exact: true })
        .count(),
      1,
    );
  });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.locator(".market-card").first().waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${output}/home-desktop.png`, fullPage: false });
  await check("Polish persists across navigation", async () => {
    await page
      .getByRole("button", { name: "Switch language to Polish" })
      .click();
    await page
      .getByRole("heading", { name: "Twoja strona. Twoja stawka." })
      .waitFor();
    await page.goto(base + "/seasons");
    await page
      .getByRole("heading", { name: "Cały sezon. Zero prowizji." })
      .waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "pl");
  });
  await page.getByRole("button", { name: "Zmień język na angielski" }).click();
  await page.screenshot({
    path: `${output}/seasons-empty.png`,
    fullPage: true,
  });
  await check("live match date and disabled no-wallet claim", async () => {
    await page.goto(`${base}/markets/${m.id}`);
    await page
      .getByRole("heading", { name: `${m.teams[0]} vs ${m.teams[1]}` })
      .waitFor({ timeout: 60000 });
    assert.match(
      await page.locator(".kickoff").textContent(),
      /Betting closes.*\d/,
    );
    if (["resolved", "cancelled"].includes(m.status))
      assert.equal(
        await page
          .getByRole("button", { name: "No bet in this wallet" })
          .isDisabled(),
        true,
      );
  });
  await page.screenshot({
    path: `${output}/match-desktop.png`,
    fullPage: true,
  });
  await check("mobile layout does not overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [`/markets/${m.id}`, "/", "/seasons", "/admin"]) {
      await page.goto(base + url, { waitUntil: "networkidle" });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Overflow at ${url}`,
      );
    }
    await page.goto(`${base}/markets/${m.id}`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: `${output}/match-mobile.png`,
      fullPage: true,
    });
  });
  const video = page.video();
  const originalVideoPath = await video.path();
  await page.close();
  await video.saveAs(`${output}/ui-walkthrough.webm`);
  await unlink(originalVideoPath);
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errors.push(e.message));
  // Isolated fixture validates the season table. This is not a live-chain screenshot.
  await check("season participant table and single stake field", async () => {
    const data = {
      id: "777",
      address: m.address,
      mint: m.mint,
      title: "Browser test season",
      kind: 0,
      historicalDemo: true,
      status: "open",
      cutoff: Math.floor(Date.now() / 1000) + 3600,
      endTime: Math.floor(Date.now() / 1000) + 7200,
      resolveDeadline: Math.floor(Date.now() / 1000) + 10800,
      participants: [
        { name: "Team A", pool: "10", units: "10000000", odds: 3 },
        { name: "Team B", pool: "20", units: "20000000", odds: 1.5 },
      ],
      totalPoolUnits: "30000000",
      payoutPoolUnits: "0",
      winner: null,
      cancelReason: 0,
      feeds: [m.oracle.primary, m.oracle.primary],
      hashes: [m.oracle.hash, m.oracle.hash],
      feeBps: 0,
      vault: m.vault,
    };
    await page.route("**/api/v1/seasons/777", (route) =>
      route.fulfill({ json: data }),
    );
    await page.goto(`${base}/seasons/777`);
    await page.getByRole("heading", { name: "Browser test season" }).waitFor();
    assert.equal(await page.locator(".participant-table tbody tr").count(), 2);
    assert.equal(
      await page.getByRole("textbox", { name: "Stake amount" }).count(),
      1,
    );
    assert.match(
      await page.locator("main").textContent(),
      /Historical demonstration/,
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  });
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/browser-checks.json`,
    JSON.stringify(
      {
        base,
        checkedAt: new Date().toISOString(),
        marketId: m.id,
        checks,
        pageErrors: errors,
        note: "Screenshots use actual devnet reads. Season table check uses an isolated test fixture; no wallet transaction was signed.",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
